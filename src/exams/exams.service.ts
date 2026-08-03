import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ExamsService {
  constructor(private prisma: PrismaService) {}

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
        OR: [
          { courseId: { in: allCourseIds } },
          { courseId: null },
        ],
      };
    }

    if (courseFilterId) {
      whereClause.courseId = courseFilterId;
    }

    const exams = await this.prisma.exam.findMany({
      where: whereClause,
      include: {
        questions: true,
      },
      orderBy: { createdAt: 'desc' },
    });

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

    const data = exams.map((e) => {
      const unlockRecord = unlocks.find((u) => u.examId === e.id);
      const result = studentResults.find((r) => r.examId === e.id);

      const isSubmitted = !!result;
      const isLocked = e.moduleId ? !unlockRecord : false;

      return {
        ...e,
        _id: e.id.toString(),
        isSubmitted,
        userResult: result ? { ...result, _id: result.id.toString() } : null,
        isLocked,
        unlockedAt: unlockRecord ? unlockRecord.unlockedAt : null,
      };
    });

    return {
      success: true,
      data,
    };
  }

  async findOneExam(id: number, userId?: number, role?: string) {
    const exam = await this.prisma.exam.findUnique({
      where: { id },
      include: {
        questions: true,
      },
    });
    if (!exam) throw new NotFoundException(`Exam with ID ${id} not found`);

    if (role === 'student' && userId && exam.courseId) {
      const enrollment = await this.prisma.enrollment.findFirst({
        where: { userId, courseId: exam.courseId },
      });
      if (!enrollment) {
        throw new ForbiddenException('Not enrolled in a course that provides this exam');
      }
    }

    return {
      success: true,
      data: { ...exam, _id: exam.id.toString() },
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
        isPublished: data.isPublished !== undefined ? !!data.isPublished : undefined,
      },
    });

    return {
      success: true,
      data: { ...updated, _id: updated.id.toString() },
    };
  }

  async submitExam(studentId: number, dto: { examId: number; answers: { questionId: number; answer: string }[] }) {
    const exam = await this.prisma.exam.findUnique({
      where: { id: dto.examId },
      include: { questions: true },
    });
    if (!exam) throw new NotFoundException(`Exam with ID ${dto.examId} not found`);

    let totalScore = 0;
    for (const ans of dto.answers || []) {
      const q = exam.questions.find((quest) => quest.id === ans.questionId);
      if (q && q.correctOption.trim().toLowerCase() === ans.answer.trim().toLowerCase()) {
        totalScore += q.marks || 1;
      }
    }

    const passed = totalScore >= exam.passingMarks;

    const result = await this.prisma.examResult.create({
      data: {
        studentId,
        examId: dto.examId,
        score: totalScore,
        maxScore: exam.totalMarks,
        passed,
        submitTime: new Date(),
        answers: dto.answers ? dto.answers : undefined,
      },
    });

    // The attempt is finished — drop its in-progress resume state so a later re-attempt
    // (if allowed) doesn't accidentally seed itself from this completed attempt's answers.
    await this.prisma.examProgress.deleteMany({ where: { examId: dto.examId, studentId } });

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
        examId: data.examId ? parseInt(data.examId, 10) : undefined,
        courseId: data.courseId ? parseInt(data.courseId, 10) : undefined,
      },
    });
    return {
      success: true,
      data: { ...question, _id: question.id.toString() },
    };
  }
}
