import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ParentService {
  constructor(private prisma: PrismaService) {}

  async getChildren(parentId: number) {
    const children = await this.prisma.user.findMany({
      where: { parentId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        avatar: true,
        rollNumber: true,
        role: true,
        isActive: true,
      },
    });

    return {
      success: true,
      data: children.map((c) => ({ ...c, _id: c.id.toString() })),
    };
  }

  private async _verifyParentChild(parentId: number, childId: number) {
    const child = await this.prisma.user.findFirst({
      where: { id: childId, parentId },
    });
    if (!child) throw new ForbiddenException('This student is not linked to your account');
    return child;
  }

  async getChildAttendance(parentId: number, childId: number) {
    await this._verifyParentChild(parentId, childId);

    const attendance = await this.prisma.attendance.findMany({
      where: { studentId: childId },
      include: {
        batch: { select: { id: true, name: true, courseId: true } },
      },
      orderBy: { date: 'desc' },
    });

    return {
      success: true,
      data: attendance.map((a) => ({ ...a, _id: a.id.toString() })),
    };
  }

  async getChildFees(parentId: number, childId: number) {
    await this._verifyParentChild(parentId, childId);

    const fees = await this.prisma.feeRecord.findMany({
      where: { studentId: childId },
      orderBy: { paymentDate: 'desc' },
    });

    const payments = await this.prisma.payment.findMany({
      where: { userId: childId },
      include: { course: true },
      orderBy: { createdAt: 'desc' },
    });

    return {
      success: true,
      data: {
        feeRecords: fees.map((f) => ({ ...f, _id: f.id.toString() })),
        payments: payments.map((p) => ({ ...p, _id: p.id.toString() })),
      },
    };
  }

  async getChildProgress(parentId: number, childId: number) {
    await this._verifyParentChild(parentId, childId);

    const enrollments = await this.prisma.enrollment.findMany({
      where: { userId: childId },
      include: { course: { select: { id: true, title: true, thumbnail: true } } },
    });

    const progressRecords = await this.prisma.courseProgress.findMany({
      where: { studentId: childId },
    });

    const examResults = await this.prisma.examResult.findMany({
      where: { studentId: childId },
      include: { exam: { select: { id: true, title: true } } },
      orderBy: { createdAt: 'desc' },
    });

    const data = enrollments.map((e) => {
      const progress = progressRecords.find((p) => p.courseId === e.courseId);
      let completedCount = 0;
      if (progress?.completedLessons) {
        try {
          completedCount = JSON.parse(progress.completedLessons).length;
        } catch (_) {}
      }
      return {
        courseId: e.courseId,
        courseTitle: e.course.title,
        courseThumbnail: e.course.thumbnail,
        completedLessons: completedCount,
      };
    });

    return {
      success: true,
      data: {
        enrolledCourses: data,
        examResults: examResults.map((r) => ({ ...r, _id: r.id.toString() })),
      },
    };
  }

  async linkChild(parentId: number, childId: number) {
    const child = await this.prisma.user.findUnique({ where: { id: childId } });
    if (!child) throw new NotFoundException(`Student with ID ${childId} not found`);
    if (child.parentId && child.parentId !== parentId) {
      throw new ForbiddenException('Student is already linked to another parent');
    }

    await this.prisma.user.update({
      where: { id: childId },
      data: { parentId },
    });

    return { success: true, message: 'Child linked successfully' };
  }
}
