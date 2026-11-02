import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ExamResultsService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    return this.prisma.examResult.findMany({
      include: {
          student: true
      }
    });
  }

  async getSummary() {
    const grouped = await this.prisma.examResult.groupBy({
      by: ['examId'],
      _count: { _all: true },
      _avg: { score: true },
    });

    const examIds = grouped.map((g) => g.examId);
    const exams = await this.prisma.exam.findMany({
      where: { id: { in: examIds } },
    });
    const examMap = new Map(exams.map((e) => [e.id, e]));

    return grouped
      .map((g) => {
        const exam = examMap.get(g.examId);
        if (!exam) return null;
        return {
          _id: exam.id.toString(),
          title: exam.title,
          duration: exam.duration,
          totalMarks: exam.totalMarks,
          passingMarks: exam.passingMarks,
          totalSubmissions: g._count._all,
          avgScore: g._avg.score || 0,
        };
      })
      .filter(Boolean)
      .sort((a: any, b: any) => a.title.localeCompare(b.title));
  }

  /**
   * Student-facing results: one entry per exam taken, each with all its attempts (oldest =
   * attempt 1). Deliberately no answers / correctness — only marks, pass/fail and timing.
   */
  async findMine(studentId: number) {
    const rows = await this.prisma.examResult.findMany({
      where: { studentId },
      orderBy: { submitTime: 'asc' },
      select: {
        id: true,
        score: true,
        maxScore: true,
        passed: true,
        submitTime: true,
        timeTakenSeconds: true,
        exam: { select: { id: true, title: true, duration: true, totalMarks: true, passingMarks: true, courseId: true } },
      },
    });

    const byExam = new Map<number, any>();
    for (const r of rows) {
      if (!r.exam) continue;
      let entry = byExam.get(r.exam.id);
      if (!entry) {
        entry = {
          examId: r.exam.id,
          _id: r.exam.id.toString(),
          title: r.exam.title,
          duration: r.exam.duration,
          totalMarks: r.exam.totalMarks,
          passingMarks: r.exam.passingMarks,
          courseId: r.exam.courseId,
          attempts: [] as any[],
        };
        byExam.set(r.exam.id, entry);
      }
      const max = r.maxScore || r.exam.totalMarks || 0;
      entry.attempts.push({
        id: r.id,
        _id: r.id.toString(),
        attempt: entry.attempts.length + 1,
        score: r.score,
        maxScore: max,
        percent: max > 0 ? Math.round((r.score / max) * 100) : 0,
        passed: r.passed,
        submittedAt: r.submitTime,
        timeTakenSeconds: r.timeTakenSeconds,
      });
    }

    return [...byExam.values()]
      .map((e) => {
        const best = e.attempts.reduce((a: any, b: any) => (b.score > a.score ? b : a));
        const last = e.attempts[e.attempts.length - 1];
        return { ...e, attemptCount: e.attempts.length, bestScore: best.score, bestPercent: best.percent, passed: e.attempts.some((a: any) => a.passed), lastAttemptAt: last.submittedAt, attempts: [...e.attempts].reverse() };
      })
      .sort((a, b) => new Date(b.lastAttemptAt).getTime() - new Date(a.lastAttemptAt).getTime());
  }

  async findDetails(id: number) {
    const result = await this.prisma.examResult.findUnique({
      where: { id },
      include: {
        student: true,
        exam: { include: { questionLinks: { include: { question: true } } } },
      },
    });
    if (!result) throw new NotFoundException(`ExamResults with ID ${id} not found`);

    const rawAnswers: any[] = Array.isArray(result.answers) ? (result.answers as any[]) : [];
    const answers = rawAnswers.map((ans) => {
      const question = result.exam?.questionLinks.find((l) => l.questionId === ans.questionId)?.question;
      const isCorrect = question ? question.correctOption.trim().toLowerCase() === (ans.answer || '').trim().toLowerCase() : false;
      return {
        questionText: question?.text || `Question #${ans.questionId}`,
        answer: ans.answer,
        isCorrect,
      };
    });

    return {
      _id: result.id.toString(),
      studentId: result.studentId, // ownership check in the controller
      score: result.score,
      maxScore: result.maxScore,
      passed: result.passed,
      submitTime: result.submitTime,
      answers,
      user: result.student ? { name: result.student.name, email: result.student.email } : null,
      exam: result.exam ? { title: result.exam.title, passingMarks: result.exam.passingMarks } : null,
    };
  }

  async findByExam(examId: number) {
    const results = await this.prisma.examResult.findMany({
      where: { examId },
      include: { student: true, exam: true },
      orderBy: { submitTime: 'desc' },
    });
    return results.map((r) => ({
      _id: r.id.toString(),
      score: r.score,
      maxScore: r.maxScore,
      passed: r.passed,
      passingMarks: r.exam?.passingMarks,
      submitTime: r.submitTime,
      user: r.student ? { name: r.student.name, email: r.student.email } : null,
    }));
  }

  async findOne(id: number) {
    const item = await this.prisma.examResult.findUnique({
      where: { id },
      include: {
          student: true
      }
    });
    if (!item) throw new NotFoundException(`ExamResults with ID ${id} not found`);
    return item;
  }

  async create(data: any) {
    return this.prisma.examResult.create({ data });
  }

  async update(id: number, data: any) {
    await this.findOne(id);
    return this.prisma.examResult.update({ where: { id }, data });
  }

  async remove(id: number) {
    await this.findOne(id);
    return this.prisma.examResult.delete({ where: { id } });
  }
}
