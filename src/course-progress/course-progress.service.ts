import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CertificatesService } from '../certificates/certificates.service';
import { calculateProgressPercent, ProgressBreakdown } from './progress-calculator';

@Injectable()
export class CourseProgressService {
  constructor(
    private prisma: PrismaService,
    private certificatesService: CertificatesService,
  ) {}

  async findAll() {
    return this.prisma.courseProgress.findMany();
  }

  async findOne(id: number) {
    const item = await this.prisma.courseProgress.findUnique({ where: { id } });
    if (!item) throw new NotFoundException(`CourseProgress with ID ${id} not found`);
    return item;
  }

  async create(data: any) {
    return this.prisma.courseProgress.create({ data });
  }

  async update(id: number, data: any) {
    await this.findOne(id);
    return this.prisma.courseProgress.update({ where: { id }, data });
  }

  async remove(id: number) {
    await this.findOne(id);
    return this.prisma.courseProgress.delete({ where: { id } });
  }

  // ─── Real progress breakdown: lessons + exams + assignments ─────────────
  private async getBreakdown(studentId: number, courseId: number): Promise<ProgressBreakdown> {
    const [totalLessons, exams, assignments, progress] = await Promise.all([
      this.prisma.lesson.count({ where: { courseId } }),
      this.prisma.exam.findMany({ where: { courseId }, select: { id: true } }),
      this.prisma.assignment.findMany({ where: { courseId }, select: { id: true } }),
      this.prisma.courseProgress.findUnique({ where: { studentId_courseId: { studentId, courseId } } }),
    ]);

    let completedLessons = 0;
    if (progress?.completedLessons) {
      try {
        completedLessons = JSON.parse(progress.completedLessons).length;
      } catch {
        completedLessons = 0;
      }
    }

    const examIds = exams.map((e) => e.id);
    const assignmentIds = assignments.map((a) => a.id);

    const [completedExamRows, completedAssignmentRows] = await Promise.all([
      examIds.length
        ? this.prisma.examResult.findMany({ where: { studentId, examId: { in: examIds } }, select: { examId: true }, distinct: ['examId'] })
        : Promise.resolve([]),
      assignmentIds.length
        ? this.prisma.assignmentSubmission.findMany({ where: { studentId, assignmentId: { in: assignmentIds } }, select: { assignmentId: true }, distinct: ['assignmentId'] })
        : Promise.resolve([]),
    ]);

    return {
      lessons: { completed: completedLessons, total: totalLessons },
      exams: { completed: completedExamRows.length, total: examIds.length },
      assignments: { completed: completedAssignmentRows.length, total: assignmentIds.length },
    };
  }

  /** Enrollment + real weighted progress % for one student/course pair. */
  async getCourseProgressSummary(studentId: number, courseId: number) {
    const enrollment = await this.prisma.enrollment.findUnique({
      where: { userId_courseId: { userId: studentId, courseId } },
    });
    const isEnrolled = !!enrollment;

    if (!isEnrolled) {
      const breakdown = await this.getBreakdown(studentId, courseId);
      return { isEnrolled: false, progressPercent: 0, breakdown, completedLessonIds: [] };
    }

    const [breakdown, progress] = await Promise.all([
      this.getBreakdown(studentId, courseId),
      this.prisma.courseProgress.findUnique({ where: { studentId_courseId: { studentId, courseId } } }),
    ]);
    let completedLessonIds: string[] = [];
    if (progress?.completedLessons) {
      try {
        completedLessonIds = JSON.parse(progress.completedLessons);
      } catch {
        completedLessonIds = [];
      }
    }
    return { isEnrolled: true, progressPercent: calculateProgressPercent(breakdown), breakdown, completedLessonIds };
  }

  /** Every course the student is enrolled in and hasn't finished yet, for Home's "Continue Learning". */
  async getContinueLearning(studentId: number) {
    const enrollments = await this.prisma.enrollment.findMany({
      where: { userId: studentId },
      include: { course: true },
      orderBy: { createdAt: 'desc' },
    });

    const withProgress = await Promise.all(
      enrollments.map(async (enrollment) => {
        const progressRecord = await this.prisma.courseProgress.findUnique({
          where: { studentId_courseId: { studentId, courseId: enrollment.courseId } },
        });
        const breakdown = await this.getBreakdown(studentId, enrollment.courseId);
        return {
          course: enrollment.course,
          progressPercent: calculateProgressPercent(breakdown),
          breakdown,
          lastActivityAt: progressRecord?.updatedAt ?? enrollment.createdAt,
        };
      }),
    );

    return withProgress
      .filter((item) => item.progressPercent < 100)
      .sort((a, b) => b.lastActivityAt.getTime() - a.lastActivityAt.getTime());
  }

  // ─── Step 2: Complete Lecture & Auto-Certificate ─────────────────────────
  async completeLecture(studentId: number, courseId: number, lectureId: string) {
    const course = await this.prisma.course.findUnique({ where: { id: courseId } });
    if (!course) throw new NotFoundException(`Course ${courseId} not found`);

    // Verify enrollment
    const isEnrolled = await this.prisma.enrollment.findFirst({
      where: { userId: studentId, courseId },
    });
    if (!isEnrolled) {
      throw new ForbiddenException('Not enrolled in this course');
    }

    // Find or create progress record
    let progress = await this.prisma.courseProgress.findUnique({
      where: {
        studentId_courseId: { studentId, courseId },
      },
    });

    let completedList: string[] = [];
    if (progress && progress.completedLessons) {
      try {
        completedList = JSON.parse(progress.completedLessons);
      } catch (_) {
        completedList = [];
      }
    }

    if (!completedList.includes(lectureId)) {
      completedList.push(lectureId);
    }

    if (!progress) {
      progress = await this.prisma.courseProgress.create({
        data: {
          studentId,
          courseId,
          completedLessons: JSON.stringify(completedList),
        },
      });
    } else {
      progress = await this.prisma.courseProgress.update({
        where: { id: progress.id },
        data: {
          completedLessons: JSON.stringify(completedList),
        },
      });
    }

    const breakdown = await this.getBreakdown(studentId, courseId);
    const progressPercent = calculateProgressPercent(breakdown);
    const certificateIssued = await this.maybeAutoIssueCertificate(studentId, courseId, progressPercent);

    return {
      success: true,
      progressPercent,
      completedCount: completedList.length,
      totalLessons: breakdown.lessons.total,
      breakdown,
      certificateIssued,
      data: {
        ...progress,
        progressPercent,
      },
    };
  }

  /**
   * Records actual watched seconds for one lecture, additively — the client only ever reports
   * small continuous-playback deltas (never the raw currentTime a seek could jump to), so
   * skipping to the end of a video can't inflate this. watchedSeconds is capped at the
   * lecture's duration so replays past 100% don't push it over.
   */
  async recordLectureWatch(studentId: number, courseId: number, lectureId: string, deltaSeconds: number, durationSeconds?: number) {
    const existing = await this.prisma.lectureProgress.findUnique({
      where: { studentId_lectureId: { studentId, lectureId } },
    });

    const effectiveDuration = durationSeconds ?? existing?.durationSeconds ?? undefined;
    const rawWatched = (existing?.watchedSeconds ?? 0) + Math.max(0, Math.round(deltaSeconds));
    const watchedSeconds = effectiveDuration ? Math.min(rawWatched, effectiveDuration) : rawWatched;

    const record = await this.prisma.lectureProgress.upsert({
      where: { studentId_lectureId: { studentId, lectureId } },
      create: { studentId, courseId, lectureId, watchedSeconds, durationSeconds: effectiveDuration },
      update: { watchedSeconds, durationSeconds: effectiveDuration },
    });

    return {
      watchedSeconds: record.watchedSeconds,
      durationSeconds: record.durationSeconds,
      percent: record.durationSeconds ? Math.min(100, Math.round((record.watchedSeconds / record.durationSeconds) * 100)) : 0,
    };
  }

  /** All of a student's per-lecture watch progress for one course, for the curriculum tab's badges. */
  async getLectureProgressForCourse(studentId: number, courseId: number) {
    const rows = await this.prisma.lectureProgress.findMany({ where: { studentId, courseId } });
    return rows.map((r) => ({
      lectureId: r.lectureId,
      watchedSeconds: r.watchedSeconds,
      durationSeconds: r.durationSeconds,
      percent: r.durationSeconds ? Math.min(100, Math.round((r.watchedSeconds / r.durationSeconds) * 100)) : 0,
    }));
  }

  /**
   * Shared by every action that can push a student's weighted progress (lessons + exams +
   * assignments) past the auto-issue threshold — completing a lecture, submitting an
   * assignment, or finishing an exam. Previously this only ran from completeLecture(), so a
   * student whose last remaining requirement was an assignment or exam (very common — video
   * watching usually finishes first) never got their certificate auto-issued at all.
   */
  async maybeAutoIssueCertificate(studentId: number, courseId: number, progressPercent?: number): Promise<boolean> {
    const pct = progressPercent ?? calculateProgressPercent(await this.getBreakdown(studentId, courseId));
    if (pct < 95) return false;

    const existingCert = await this.prisma.certificate.findFirst({ where: { userId: studentId, courseId } });
    if (existingCert) return false;

    try {
      await this.certificatesService.issueCertificate({ studentId, courseId, force: true });
      return true;
    } catch (err) {
      console.error('[CourseProgressService] Auto certificate issue error:', err.message);
      return false;
    }
  }
}
