import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CourseProgressService } from '../course-progress/course-progress.service';
import { UnlockContext, evaluateUnlock, unlockFieldsFromBody } from '../common/course-unlock';

// Exam ↔ Question is many-to-many through ExamQuestion. Include the links and flatten them
// back to `exam.questions` so every API consumer (web, mobile, results) keeps its old shape.
const WITH_QUESTIONS = {
  questionLinks: { include: { question: true }, orderBy: { createdAt: 'asc' as const } },
};

const flattenQuestions = <T extends { questionLinks?: { question: any }[] }>(exam: T) => {
  const { questionLinks, ...rest } = exam;
  return {
    ...rest,
    questions: (questionLinks || []).map((l) => l.question).filter((q) => q && !q.isDeleted),
  };
};

// Students get the questions without the answer key; grading happens server-side on submit.
const canSeeAnswers = (role?: string) => role === 'admin' || role === 'teacher';
const hideAnswers = <T extends { questions: any[] }>(exam: T): T => ({
  ...exam,
  questions: exam.questions.map(({ correctOption, explanation, ...q }) => q),
});

/** Stable per-student pick of `count` questions (same student + exam gives the same questions every load). */
const pickSubset = <T extends { id: number }>(questions: T[], count: number | null | undefined, seed: string): T[] => {
  if (!count || count <= 0 || count >= questions.length) return questions;
  const rank = (id: number) => {
    let h = 2166136261;
    for (const ch of `${seed}:${id}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    return h >>> 0;
  };
  return [...questions].sort((a, b) => rank(a.id) - rank(b.id)).slice(0, count);
};

@Injectable()
export class ExamsService {
  constructor(
    private prisma: PrismaService,
    private courseProgressService: CourseProgressService,
  ) {}

  /** Whether this exam is still closed for the student, and why (the app shows the reason). */
  private async lockInfo(
    exam: { id: number; courseId: number | null; moduleId: number | null; unlockMode: string; unlockAfterDays: number | null; unlockAfterModules: number | null; unlockModuleIndex: number | null },
    studentId: number,
    ctx: UnlockContext,
    unlockedExamIds: Set<number>,
  ): Promise<{ locked: boolean; reason: string | null }> {
    if (exam.unlockMode !== 'immediate') return evaluateUnlock(this.prisma, exam, studentId, exam.courseId, ctx);
    // "immediate": opens with the course. A legacy exam pinned to a module still needs an ExamUnlock row.
    if (exam.moduleId && !unlockedExamIds.has(exam.id)) return { locked: true, reason: 'This exam has not been unlocked yet' };
    return { locked: false, reason: null };
  }

  /** Unlock rule + question count from a create/update body (only keys that were actually sent). */
  private unlockFields(data: any) {
    const out: Record<string, any> = unlockFieldsFromBody(data);
    const int = (v: any) => (v === '' || v === null || v === undefined || Number.isNaN(Number(v)) ? null : Math.trunc(Number(v)));
    if (data && 'questionCount' in data) {
      const n = int(data.questionCount);
      out.questionCount = n && n > 0 ? n : null;
    }
    return out;
  }

  async findAllExams(userId?: number, role?: string, courseFilterId?: number) {
    let whereClause: any = { isPublished: true };

    if (role === 'teacher' && userId) {
      whereClause = { createdBy: userId };
    } else if (role === 'student' && userId) {
      const enrollments = await this.prisma.enrollment.findMany({
        where: { userId },
        select: { courseId: true },
      });
      const enrolledCourseIds = enrollments.map((e) => e.courseId);

      const attendances = await this.prisma.attendance.findMany({
        where: { studentId: userId },
        include: { batch: true },
      });
      const batchCourseIds = attendances.map((a) => a.batch?.courseId).filter(Boolean) as number[];

      const allCourseIds = [...new Set([...enrolledCourseIds, ...batchCourseIds])];

      whereClause = {
        isPublished: true,
        OR: [
          { courseId: { in: allCourseIds } },
          { courseId: null },
        ],
      };
    }

    if (courseFilterId) {
      whereClause.courseId = courseFilterId;
    }

    const exams = (
      await this.prisma.exam.findMany({
        where: whereClause,
        include: WITH_QUESTIONS,
        orderBy: { createdAt: 'desc' },
      })
    )
      .map(flattenQuestions)
      .map((e) => (canSeeAnswers(role) ? e : hideAnswers(e)));

    let unlocks: any[] = [];
    let studentResults: any[] = [];

    if (userId) {
      unlocks = await this.prisma.examUnlock.findMany({
        where: { studentId: userId },
      });
      studentResults = await this.prisma.examResult.findMany({
        where: { studentId: userId },
        orderBy: { createdAt: 'desc' },
      });
    }

    const unlockedExamIds = new Set<number>(unlocks.map((u) => u.examId));
    const unlockCtx = new UnlockContext();
    const isStudentView = role === 'student' && !!userId;

    const data = await Promise.all(
      exams.map(async (e) => {
        const unlockRecord = unlocks.find((u) => u.examId === e.id);
        const result = studentResults.find((r) => r.examId === e.id);

        const isSubmitted = !!result;
        const lock = isStudentView
          ? await this.lockInfo(e, userId!, unlockCtx, unlockedExamIds)
          : { locked: e.moduleId ? !unlockRecord && e.unlockMode === 'immediate' : false, reason: null as string | null };
        // Students only get their own stable subset of the questions.
        const questions = isStudentView ? pickSubset(e.questions, e.questionCount, `${userId}:${e.id}`) : e.questions;

        return {
          ...e,
          questions,
          _id: e.id.toString(),
          isSubmitted,
          userResult: result ? { ...result, _id: result.id.toString() } : null,
          isLocked: lock.locked,
          lockReason: lock.reason,
          unlockedAt: unlockRecord ? unlockRecord.unlockedAt : null,
        };
      }),
    );

    return {
      success: true,
      data,
    };
  }

  async findOneExam(id: number, userId?: number, role?: string) {
    const row = await this.prisma.exam.findUnique({
      where: { id },
      include: WITH_QUESTIONS,
    });
    if (!row) throw new NotFoundException(`Exam with ID ${id} not found`);
    const flat = flattenQuestions(row);
    const exam = canSeeAnswers(role) ? flat : hideAnswers(flat);

    if (role === 'student' && userId && exam.courseId) {
      const enrollment = await this.prisma.enrollment.findFirst({
        where: { userId, courseId: exam.courseId },
      });
      if (!enrollment) {
        throw new ForbiddenException('Not enrolled in a course that provides this exam');
      }
      const unlocks = await this.prisma.examUnlock.findMany({ where: { studentId: userId, examId: id }, select: { examId: true } });
      const lock = await this.lockInfo(exam, userId, new UnlockContext(), new Set(unlocks.map((u) => u.examId)));
      if (lock.locked) throw new ForbiddenException(lock.reason || 'This exam is locked');
    }

    const questions = role === 'student' && userId ? pickSubset(exam.questions, exam.questionCount, `${userId}:${exam.id}`) : exam.questions;

    return {
      success: true,
      data: { ...exam, questions, _id: exam.id.toString() },
    };
  }

  async createExam(userId: number, data: any) {
    const exam = await this.prisma.exam.create({
      data: {
        title: data.title,
        description: data.description || '',
        duration: parseInt(data.duration, 10) || 60,
        totalMarks: parseFloat(data.totalMarks) || 100,
        passingMarks: parseFloat(data.passingMarks) || 40,
        startDate: data.startDate ? new Date(data.startDate) : new Date(),
        endDate: data.endDate ? new Date(data.endDate) : undefined,
        courseId: data.courseId ? parseInt(data.courseId, 10) : undefined,
        moduleId: data.moduleId ? parseInt(data.moduleId, 10) : undefined,
        ...this.unlockFields(data),
        createdBy: userId,
        isPublished: data.isPublished !== undefined ? !!data.isPublished : true,
      },
    });

    return {
      success: true,
      data: { ...exam, _id: exam.id.toString() },
    };
  }

  async updateExam(id: number, userId: number, role: string, data: any) {
    const exam = await this.prisma.exam.findUnique({ where: { id } });
    if (!exam) throw new NotFoundException(`Exam with ID ${id} not found`);

    if (role !== 'admin' && exam.createdBy !== userId) {
      throw new ForbiddenException('Not authorized to update this exam');
    }

    const updated = await this.prisma.exam.update({
      where: { id },
      data: {
        title: data.title,
        description: data.description,
        duration: data.duration ? parseInt(data.duration, 10) : undefined,
        totalMarks: data.totalMarks ? parseFloat(data.totalMarks) : undefined,
        passingMarks: data.passingMarks ? parseFloat(data.passingMarks) : undefined,
        startDate: data.startDate ? new Date(data.startDate) : undefined,
        endDate: data.endDate ? new Date(data.endDate) : undefined,
        // `? :` treated an explicit `null` (unassign from a course) the same as "field not
        // sent" and silently kept the old value — a course-assignment modal toggling an
        // exam off could never actually clear it. Checking for the key's presence instead
        // lets `courseId: null` really persist as null, while an omitted key still no-ops.
        courseId: 'courseId' in data ? (data.courseId === null ? null : parseInt(data.courseId, 10)) : undefined,
        moduleId: data.moduleId ? parseInt(data.moduleId, 10) : undefined,
        ...this.unlockFields(data),
        isPublished: data.isPublished !== undefined ? !!data.isPublished : undefined,
      },
    });

    return {
      success: true,
      data: { ...updated, _id: updated.id.toString() },
    };
  }

  // Replaces this exam's question set: unticked links are removed, new ones added. Other
  // exams' links to the same questions are untouched.
  async setExamQuestions(id: number, userId: number, role: string, questionIds: any[]) {
    const exam = await this.prisma.exam.findUnique({ where: { id } });
    if (!exam) throw new NotFoundException(`Exam with ID ${id} not found`);

    if (role !== 'admin' && exam.createdBy !== userId) {
      throw new ForbiddenException('Not authorized to update this exam');
    }

    const ids = (Array.isArray(questionIds) ? questionIds : [])
      .map((q) => parseInt(q, 10))
      .filter((n) => Number.isInteger(n));

    const existing = await this.prisma.question.findMany({ where: { id: { in: ids } }, select: { id: true } });
    const validIds = existing.map((q) => q.id);

    await this.prisma.$transaction([
      this.prisma.examQuestion.deleteMany({
        where: { examId: id, questionId: { notIn: validIds } },
      }),
      this.prisma.examQuestion.createMany({
        data: validIds.map((questionId) => ({ examId: id, questionId })),
        skipDuplicates: true,
      }),
    ]);

    return { success: true, data: { examId: id, questionIds: validIds } };
  }

  async submitExam(studentId: number, dto: { examId: number; answers: { questionId: number; answer: string }[]; timeTakenSeconds?: number }) {
    const row = await this.prisma.exam.findUnique({
      where: { id: dto.examId },
      include: WITH_QUESTIONS,
    });
    const exam = row ? flattenQuestions(row) : null;
    if (!exam) throw new NotFoundException(`Exam with ID ${dto.examId} not found`);

    const unlocked = await this.prisma.examUnlock.findMany({ where: { studentId, examId: exam.id }, select: { examId: true } });
    const lock = await this.lockInfo(exam, studentId, new UnlockContext(), new Set(unlocked.map((u) => u.examId)));
    if (lock.locked) throw new ForbiddenException(lock.reason || 'This exam is locked');

    let totalScore = 0;
    for (const ans of dto.answers || []) {
      const q = exam.questions.find((quest) => quest.id === ans.questionId);
      if (q && q.correctOption.trim().toLowerCase() === ans.answer.trim().toLowerCase()) {
        totalScore += q.marks || 1;
      }
    }

    const passed = totalScore >= exam.passingMarks;

    // Time on this attempt: the app's own timer, else since the attempt's resume state was
    // first saved. Never more than the exam's duration (plus a little submit latency).
    const limit = exam.duration * 60 + 120;
    let timeTaken = typeof dto.timeTakenSeconds === 'number' ? Math.round(dto.timeTakenSeconds) : null;
    if (timeTaken === null) {
      const started = await this.prisma.examProgress.findUnique({
        where: { examId_studentId: { examId: dto.examId, studentId } },
        select: { createdAt: true },
      });
      if (started) timeTaken = Math.round((Date.now() - started.createdAt.getTime()) / 1000);
    }
    const timeTakenSeconds = timeTaken === null ? null : Math.min(Math.max(timeTaken, 0), limit);

    const result = await this.prisma.examResult.create({
      data: {
        studentId,
        examId: dto.examId,
        score: totalScore,
        maxScore: exam.totalMarks,
        passed,
        submitTime: new Date(),
        timeTakenSeconds,
        answers: dto.answers ? dto.answers : undefined,
      },
    });

    // The attempt is finished — drop its in-progress resume state so a later re-attempt
    // (if allowed) doesn't accidentally seed itself from this completed attempt's answers.
    await this.prisma.examProgress.deleteMany({ where: { examId: dto.examId, studentId } });

    // Same reasoning as AssignmentsService.submitAssignment — an exam can be the last
    // requirement standing between a student and 95% weighted progress.
    if (exam.courseId) {
      await this.courseProgressService.maybeAutoIssueCertificate(studentId, exam.courseId);
    }

    return {
      success: true,
      message: passed ? 'Congratulations! You passed the exam.' : 'Exam submitted. Passing score not reached.',
      data: {
        ...result,
        _id: result.id.toString(),
        examTitle: exam.title,
        passingMarks: exam.passingMarks,
      },
    };
  }

  async getProgress(examId: number, studentId: number) {
    const progress = await this.prisma.examProgress.findUnique({
      where: { examId_studentId: { examId, studentId } },
    });
    if (!progress) return null;
    return {
      answers: progress.answers ?? {},
      marked: progress.marked ?? [],
      visited: progress.visited ?? [],
      currentIndex: progress.currentIndex,
    };
  }

  async saveProgress(
    examId: number,
    studentId: number,
    data: { answers?: Record<string, string>; marked?: number[]; visited?: number[]; currentIndex?: number },
  ) {
    const progress = await this.prisma.examProgress.upsert({
      where: { examId_studentId: { examId, studentId } },
      create: {
        examId,
        studentId,
        answers: data.answers ?? {},
        marked: data.marked ?? [],
        visited: data.visited ?? [],
        currentIndex: data.currentIndex ?? 0,
      },
      update: {
        answers: data.answers ?? undefined,
        marked: data.marked ?? undefined,
        visited: data.visited ?? undefined,
        currentIndex: data.currentIndex ?? undefined,
      },
    });
    return {
      answers: progress.answers ?? {},
      marked: progress.marked ?? [],
      visited: progress.visited ?? [],
      currentIndex: progress.currentIndex,
    };
  }

  async findAllResults() {
    const results = await this.prisma.examResult.findMany({
      include: { student: true, exam: true },
      orderBy: { createdAt: 'desc' },
    });
    return {
      success: true,
      data: results.map((r) => ({ ...r, _id: r.id.toString() })),
    };
  }

  async submitResult(data: any) {
    const result = await this.prisma.examResult.create({
      data: {
        score: parseFloat(data.score) || 0,
        studentId: parseInt(data.studentId, 10),
        examId: parseInt(data.examId, 10),
      },
    });
    return {
      success: true,
      data: { ...result, _id: result.id.toString() },
    };
  }

  async findAllQuestions() {
    const questions = await this.prisma.question.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return {
      success: true,
      data: questions.map((q) => ({ ...q, _id: q.id.toString() })),
    };
  }

  async createQuestion(data: any) {
    const question = await this.prisma.question.create({
      data: {
        text: data.text,
        options: data.options,
        correctOption: data.correctOption,
        marks: data.marks ? parseFloat(data.marks) : 1,
        explanation: data.explanation || '',
        courseId: data.courseId ? parseInt(data.courseId, 10) : undefined,
        ...(data.examId ? { examLinks: { create: { examId: parseInt(data.examId, 10) } } } : {}),
      },
    });
    return {
      success: true,
      data: { ...question, _id: question.id.toString() },
    };
  }
}
