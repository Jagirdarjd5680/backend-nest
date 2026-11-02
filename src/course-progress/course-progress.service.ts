import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CertificatesService } from '../certificates/certificates.service';
import { calculateProgressPercent, ProgressBreakdown } from './progress-calculator';
import { courseLectures } from './course-lectures';

/** Watching this share of a lecture marks it complete; skipping to the end doesn't. */
const AUTO_COMPLETE_RATIO = 0.9;
const MIN_COMPLETE_RATIO = 0.8;

export type WatchSummary = { watchedSeconds: number; totalSeconds: number; percent: number };

const UNIT_SECONDS: Record<string, number> = { minutes: 60, hours: 3600, days: 86400, weeks: 604800, months: 2592000 };

/** Estimated Reading Time (value + unit from the course form) in seconds; 0 when not set. */
function readingTimeSeconds(value: number, unit: string): number {
  const per = UNIT_SECONDS[(unit || 'hours').toLowerCase()] ?? 3600;
  return value > 0 ? Math.round(value * per) : 0;
}

/** Percent with one decimal below 10 (so 12 s of 45 h shows 0.1, not 0), whole numbers above. */
function watchPercent(watched: number, total: number): number {
  if (!total || watched <= 0) return 0;
  const pct = Math.min(100, (watched / total) * 100);
  return pct < 10 ? Math.max(0.1, Math.round(pct * 10) / 10) : Math.round(pct);
}

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

  /**
   * Actual time watched vs. total video length for a course. Each lecture counts at most its
   * own duration (rewatching adds nothing past 100%); seeks never count (the client only
   * reports continuous-playback deltas). Lectures whose length the course JSON doesn't know
   * use the duration the player reported.
   */
  async getWatchSummary(studentId: number, courseId: number, course?: { modules: unknown; readingDurationValue: number; readingDurationUnit: string }): Promise<WatchSummary> {
    const [c, rows] = await Promise.all([
      course
        ? Promise.resolve(course)
        : this.prisma.course.findUnique({ where: { id: courseId }, select: { modules: true, readingDurationValue: true, readingDurationUnit: true } }),
      this.prisma.lectureProgress.findMany({ where: { studentId, courseId } }),
    ]);

    // The admin's "Estimated Reading Time" is the course's total; every second watched counts
    // toward it, rewatches included (5 videos × 2 h = 10 h of video can take 45 h of study).
    const readingSeconds = readingTimeSeconds(c?.readingDurationValue ?? 0, c?.readingDurationUnit ?? 'hours');
    if (readingSeconds > 0) {
      const watchedSeconds = rows.reduce((sum, r) => sum + (r.totalWatchedSeconds || 0), 0);
      return { watchedSeconds, totalSeconds: readingSeconds, percent: watchPercent(watchedSeconds, readingSeconds) };
    }

    // No reading time set: total = the videos' own length, each counted once.
    const byId = new Map(rows.map((r) => [r.lectureId, r]));
    let watchedSeconds = 0;
    let totalSeconds = 0;
    for (const lecture of courseLectures(courseId, c?.modules)) {
      if (!['video', 'audio', 'youtube_live'].includes(lecture.type)) continue;
      const row = byId.get(lecture.id);
      const duration = lecture.duration || row?.durationSeconds || 0;
      totalSeconds += duration;
      if (row) watchedSeconds += duration ? Math.min(row.watchedSeconds, duration) : 0;
    }
    return { watchedSeconds, totalSeconds, percent: watchPercent(watchedSeconds, totalSeconds) };
  }


  /** Enrollment + real weighted progress % for one student/course pair. */
  async getCourseProgressSummary(studentId: number, courseId: number) {
    const enrollment = await this.prisma.enrollment.findUnique({
      where: { userId_courseId: { userId: studentId, courseId } },
    });
    const isEnrolled = !!enrollment;

    if (!isEnrolled) {
      const breakdown = await this.getBreakdown(studentId, courseId);
      return { isEnrolled: false, progressPercent: 0, breakdown, completedLessonIds: [], watch: { watchedSeconds: 0, totalSeconds: 0, percent: 0 } };
    }

    const [breakdown, progress, watch] = await Promise.all([
      this.getBreakdown(studentId, courseId),
      this.prisma.courseProgress.findUnique({ where: { studentId_courseId: { studentId, courseId } } }),
      this.getWatchSummary(studentId, courseId),
    ]);
    let completedLessonIds: string[] = [];
    if (progress?.completedLessons) {
      try {
        completedLessonIds = JSON.parse(progress.completedLessons);
      } catch {
        completedLessonIds = [];
      }
    }
    return { isEnrolled: true, progressPercent: calculateProgressPercent(breakdown), breakdown, completedLessonIds, watch };
  }

  /** Progress block attached to each `/courses/my/enrolled` row. */
  async getEnrollmentProgress(studentId: number, courseId: number) {
    const [breakdown, watch, record] = await Promise.all([
      this.getBreakdown(studentId, courseId),
      this.getWatchSummary(studentId, courseId),
      this.prisma.courseProgress.findUnique({ where: { studentId_courseId: { studentId, courseId } }, select: { updatedAt: true } }),
    ]);
    return {
      progressPercent: calculateProgressPercent(breakdown),
      breakdown,
      watch,
      timeSpent: watch.watchedSeconds,
      lastActivityAt: record?.updatedAt ?? null,
    };
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
        const watch = await this.getWatchSummary(studentId, enrollment.courseId, enrollment.course);
        return {
          course: enrollment.course,
          progressPercent: calculateProgressPercent(breakdown),
          breakdown,
          watch,
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

    // A lecture whose real watch time is known only completes once most of it was watched —
    // the player fires "ended" after a seek to the end too. (Web reports no watch time, so
    // lectures without a LectureProgress row are completed as before.)
    const watched = await this.prisma.lectureProgress.findUnique({
      where: { studentId_lectureId: { studentId, lectureId } },
    });
    if (watched?.durationSeconds && watched.watchedSeconds < watched.durationSeconds * MIN_COMPLETE_RATIO) {
      const breakdown = await this.getBreakdown(studentId, courseId);
      return { success: false, message: 'Watch more of this lecture to complete it', progressPercent: calculateProgressPercent(breakdown), breakdown };
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
      create: { studentId, courseId, lectureId, watchedSeconds, totalWatchedSeconds: Math.max(0, Math.round(deltaSeconds)), durationSeconds: effectiveDuration },
      update: { watchedSeconds, totalWatchedSeconds: { increment: Math.max(0, Math.round(deltaSeconds)) }, durationSeconds: effectiveDuration },
    });

    if (record.durationSeconds && record.watchedSeconds >= record.durationSeconds * AUTO_COMPLETE_RATIO) {
      await this.completeLecture(studentId, courseId, lectureId).catch(() => undefined);
    }

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
