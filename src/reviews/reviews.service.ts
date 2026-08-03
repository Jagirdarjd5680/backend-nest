import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { REALTIME_EVENTS } from '../realtime/events';

@Injectable()
export class ReviewsService {
  constructor(
    private prisma: PrismaService,
    private realtimeService: RealtimeService,
  ) {}

  /**
   * Course detail page's Reviews tab (web) and the equivalent native-app screen — list +
   * average, with `isMine` flagged per row so the UI can offer "Edit" instead of a second
   * submit for whichever review belongs to the requesting user.
   */
  async findByCourse(courseId: number, requestingUserId?: number) {
    const reviews = await this.prisma.review.findMany({
      where: { courseId },
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { id: true, name: true, avatar: true } } },
    });
    const average = reviews.length ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length : 0;
    return {
      average: Math.round(average * 10) / 10,
      count: reviews.length,
      reviews: reviews.map((r) => ({ ...r, isMine: r.userId === requestingUserId })),
    };
  }

  /**
   * One review per student per course (see the @@unique([userId, courseId]) on Review) —
   * same account submitting again, whether from web or the app, edits that same row instead
   * of creating a duplicate. Enrollment-gated: only students who actually bought/enrolled in
   * the course can review it.
   */
  async upsertMyReview(userId: number, courseId: number, rating: number, comment: string) {
    const enrollment = await this.prisma.enrollment.findUnique({
      where: { userId_courseId: { userId, courseId } },
    });
    if (!enrollment) {
      throw new ForbiddenException('Enroll in this course before reviewing it');
    }

    const review = await this.prisma.review.upsert({
      where: { userId_courseId: { userId, courseId } },
      create: { userId, courseId, rating, comment },
      update: { rating, comment },
    });

    this.realtimeService.emitToRoom(`course_${courseId}`, REALTIME_EVENTS.REVIEW_ADDED, { courseId, userId });
    return review;
  }

  async findAll() {
    return this.prisma.review.findMany({
      include: {
          course: true,
          user: true
      }
    });
  }

  async findOne(id: number) {
    const item = await this.prisma.review.findUnique({
      where: { id },
      include: {
          course: true,
          user: true
      }
    });
    if (!item) throw new NotFoundException(`Reviews with ID ${id} not found`);
    return item;
  }

  async create(data: any) {
    return this.prisma.review.create({ data });
  }

  async update(id: number, data: any) {
    await this.findOne(id);
    return this.prisma.review.update({ where: { id }, data });
  }

  async remove(id: number) {
    await this.findOne(id);
    return this.prisma.review.delete({ where: { id } });
  }
}
