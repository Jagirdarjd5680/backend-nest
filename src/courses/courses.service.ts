import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Platform, assertCoursePlatformAccess } from '../common/platform';

@Injectable()
export class CoursesService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    return this.prisma.course.findMany({
      include: {
        category: {
          select: {
            id: true,
            name: true,
          },
        },
        instructor: {
          select: {
            id: true,
            name: true,
            email: true,
            avatar: true,
          },
        },
        lessons: {
          select: {
            id: true,
            title: true,
            type: true,
            duration: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  /**
   * `platform` is only passed by viewer-facing call sites (controller's public
   * findOne, enrollFree, payments createOrder) — internal callers (update,
   * duplicate, publish, remove) omit it so admin/teacher actions are never
   * blocked by a student-facing restriction.
   */
  async findOne(id: number, platform?: Platform | null) {
    const course = await this.prisma.course.findUnique({
      where: { id },
      include: {
        category: true,
        instructor: {
          select: {
            id: true,
            name: true,
            email: true,
            avatar: true,
          },
        },
        lessons: true,
      },
    });
    if (!course) {
      throw new NotFoundException(`Course with ID ${id} not found`);
    }
    assertCoursePlatformAccess(course.platformAccess, platform ?? null);
    return course;
  }

  /** Displayed like count = the admin-seeded fakeLikes baseline + real per-user likes. */
  async getLikeStatus(courseId: number, userId: number) {
    const [course, realLikes, myLike] = await Promise.all([
      this.prisma.course.findUnique({ where: { id: courseId }, select: { fakeLikes: true } }),
      this.prisma.courseLike.count({ where: { courseId } }),
      this.prisma.courseLike.findUnique({ where: { userId_courseId: { userId, courseId } } }),
    ]);
    if (!course) throw new NotFoundException(`Course with ID ${courseId} not found`);
    return { liked: !!myLike, likeCount: course.fakeLikes + realLikes };
  }

  async toggleLike(courseId: number, userId: number) {
    const existing = await this.prisma.courseLike.findUnique({ where: { userId_courseId: { userId, courseId } } });
    if (existing) {
      await this.prisma.courseLike.delete({ where: { id: existing.id } });
    } else {
      await this.prisma.courseLike.create({ data: { userId, courseId } });
    }
    return this.getLikeStatus(courseId, userId);
  }

  /**
   * Admin/teacher "view course" — a superset of findOne(id, null) (no platform gate, since
   * that restriction only makes sense for the student-facing browse/purchase/view flow) that
   * also surfaces the real enrollment/exam/assignment/review numbers CourseViewModal.jsx
   * displays. Those used to be read off nonexistent Mongo-era fields (course.enrolledStudents,
   * course.examCount, ...) and always showed 0/empty.
   */
  async findOneForManage(id: number) {
    const course = await this.findOne(id, null);

    const [enrolledCount, examCount, assignmentCount, exams, assignments, reviewAgg] = await Promise.all([
      this.prisma.enrollment.count({ where: { courseId: id } }),
      this.prisma.exam.count({ where: { courseId: id } }),
      this.prisma.assignment.count({ where: { courseId: id } }),
      this.prisma.exam.findMany({
        where: { courseId: id },
        select: { id: true, title: true, duration: true, totalMarks: true },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.assignment.findMany({
        where: { courseId: id },
        select: { id: true, title: true, assignmentType: true, totalMarks: true },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.review.aggregate({ where: { courseId: id }, _avg: { rating: true }, _count: true }),
    ]);

    return {
      ...course,
      enrolledCount,
      examCount,
      assignmentCount,
      rating: reviewAgg._avg.rating || 0,
      reviewCount: reviewAgg._count,
      exams: exams.map((e) => ({ ...e, _id: e.id.toString() })),
      assignments: assignments.map((a) => ({ ...a, _id: a.id.toString() })),
    };
  }

  async create(data: any) {
    const categoryId = parseInt(data.category || data.categoryId, 10);
    if (isNaN(categoryId)) {
      throw new BadRequestException('Category is required');
    }
    const instructorId = parseInt(data.instructorId || 1, 10);

    const course = await this.prisma.course.create({
      data: {
        title: data.title,
        description: data.description || '',
        thumbnail: data.thumbnail || '',
        price: parseFloat(data.price) || 0,
        originalPrice: parseFloat(data.originalPrice) || 0,
        level: data.level || 'beginner',
        isPublished: !!data.isPublished,
        durationValue: parseFloat(data.durationValue) || 0,
        durationUnit: data.durationUnit || 'months',
        readingDurationValue: parseFloat(data.readingDurationValue) || 0,
        readingDurationUnit: data.readingDurationUnit || 'hours',
        demoVideoUrl: data.demoVideoUrl || '',
        isCertificate: !!data.isCertificate,
        certificateName: data.certificateName || '',
        gstType: data.gstType || 'none',
        gstPercent: parseFloat(data.gstPercent) || 0,
        fakeLikes: parseInt(data.fakeLikes, 10) || 0,
        courseType: data.courseType || 'online',
        allowOtherBatchMaterials: !!data.allowOtherBatchMaterials,
        platformAccess: data.platformAccess || 'both',
        modules: data.modules ? data.modules : [],
        categoryId,
        instructorId,
      },
    });

    if (data.modules && Array.isArray(data.modules)) {
      const lessonsToCreate = [];
      data.modules.forEach((mod: any) => {
        (mod.videos || []).forEach((vid: any) => {
          lessonsToCreate.push({
            title: vid.title,
            description: vid.description || '',
            type: vid.type || 'video',
            url: vid.videoUrl || vid.url || '',
            duration: parseInt(vid.duration, 10) || 0,
            freePreview: !!vid.freePreview,
            courseId: course.id,
          });
        });
      });

      if (lessonsToCreate.length > 0) {
        await this.prisma.lesson.createMany({
          data: lessonsToCreate,
        });
      }
    }

    return course;
  }

  async update(id: number, data: any) {
    await this.findOne(id);

    const categoryId = (data.category || data.categoryId) ? parseInt(data.category || data.categoryId, 10) : undefined;
    const instructorId = data.instructorId ? parseInt(data.instructorId, 10) : undefined;

    const course = await this.prisma.course.update({
      where: { id },
      data: {
        title: data.title,
        description: data.description,
        thumbnail: data.thumbnail,
        price: data.price !== undefined ? parseFloat(data.price) : undefined,
        originalPrice: data.originalPrice !== undefined ? parseFloat(data.originalPrice) : undefined,
        level: data.level,
        isPublished: data.isPublished !== undefined ? !!data.isPublished : undefined,
        durationValue: data.durationValue !== undefined ? parseFloat(data.durationValue) : undefined,
        durationUnit: data.durationUnit,
        readingDurationValue: data.readingDurationValue !== undefined ? parseFloat(data.readingDurationValue) : undefined,
        readingDurationUnit: data.readingDurationUnit,
        demoVideoUrl: data.demoVideoUrl,
        isCertificate: data.isCertificate !== undefined ? !!data.isCertificate : undefined,
        certificateName: data.certificateName,
        gstType: data.gstType,
        gstPercent: data.gstPercent !== undefined ? parseFloat(data.gstPercent) : undefined,
        fakeLikes: data.fakeLikes !== undefined ? parseInt(data.fakeLikes, 10) : undefined,
        courseType: data.courseType,
        allowOtherBatchMaterials: data.allowOtherBatchMaterials !== undefined ? !!data.allowOtherBatchMaterials : undefined,
        platformAccess: data.platformAccess || undefined,
        modules: data.modules ? data.modules : undefined,
        categoryId,
        instructorId,
      },
    });

    if (data.modules && Array.isArray(data.modules)) {
      await this.prisma.lesson.deleteMany({
        where: { courseId: id },
      });

      const lessonsToCreate = [];
      data.modules.forEach((mod: any) => {
        (mod.videos || []).forEach((vid: any) => {
          lessonsToCreate.push({
            title: vid.title,
            description: vid.description || '',
            type: vid.type || 'video',
            url: vid.videoUrl || vid.url || '',
            duration: parseInt(vid.duration, 10) || 0,
            freePreview: !!vid.freePreview,
            courseId: id,
          });
        });
      });

      if (lessonsToCreate.length > 0) {
        await this.prisma.lesson.createMany({
          data: lessonsToCreate,
        });
      }
    }

    return course;
  }

  async remove(id: number) {
    await this.findOne(id);
    return this.prisma.course.delete({
      where: { id },
    });
  }

  /**
   * Free-course "Enroll Now" — paid courses only ever get an Enrollment row
   * via payments.service.ts on verified payment; this is the equivalent
   * direct path for price === 0 courses, so a student must still explicitly
   * enroll (no course silently unlocks itself).
   */
  async enrollFree(userId: number, courseId: number, platform?: Platform | null) {
    const course = await this.findOne(courseId, platform);
    if (course.price > 0) {
      throw new ForbiddenException('This course must be purchased before enrolling');
    }

    const enrollment = await this.prisma.enrollment.upsert({
      where: { userId_courseId: { userId, courseId } },
      create: { userId, courseId },
      update: {},
    });

    return enrollment;
  }

  /** The student's own enrolled courses — used to gate the web menu/dashboard and the course viewer. */
  async findMyEnrollments(userId: number) {
    return this.prisma.enrollment.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: {
        course: {
          select: { id: true, title: true, thumbnail: true, price: true },
        },
      },
    });
  }

  async publish(id: number, isPublished: boolean) {
    await this.findOne(id);
    return this.prisma.course.update({
      where: { id },
      data: { isPublished },
    });
  }

  async duplicate(id: number) {
    const original = await this.findOne(id);
    const duplicated = await this.prisma.course.create({
      data: {
        title: `${original.title} (Copy)`,
        description: original.description,
        thumbnail: original.thumbnail,
        price: original.price,
        originalPrice: original.originalPrice,
        level: original.level,
        isPublished: false,
        durationValue: original.durationValue,
        durationUnit: original.durationUnit,
        readingDurationValue: original.readingDurationValue,
        readingDurationUnit: original.readingDurationUnit,
        demoVideoUrl: original.demoVideoUrl,
        isCertificate: original.isCertificate,
        certificateName: original.certificateName,
        gstType: original.gstType,
        gstPercent: original.gstPercent,
        fakeLikes: original.fakeLikes,
        courseType: original.courseType,
        allowOtherBatchMaterials: original.allowOtherBatchMaterials,
        platformAccess: original.platformAccess,
        modules: original.modules ? original.modules : [],
        categoryId: original.categoryId,
        instructorId: original.instructorId,
      },
    });

    if (original.lessons && original.lessons.length > 0) {
      const lessonsToCreate = original.lessons.map(l => ({
        title: l.title,
        description: l.description || '',
        type: l.type,
        url: l.url,
        duration: l.duration,
        freePreview: l.freePreview,
        courseId: duplicated.id,
      }));

      await this.prisma.lesson.createMany({
        data: lessonsToCreate,
      });
    }

    return duplicated;
  }
}
