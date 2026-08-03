import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ReportsService {
  constructor(private prisma: PrismaService) {}

  async getDashboard(startDate?: string, endDate?: string, userRole?: string, userId?: number) {
    const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const end = endDate ? new Date(endDate) : new Date();
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);

    const [totalStudents, totalUsers, totalCourses, totalPayments] = await Promise.all([
      this.prisma.user.count({ where: { role: 'student' } }),
      this.prisma.user.count(),
      this.prisma.course.count(),
      this.prisma.payment.aggregate({ _sum: { amount: true }, where: { status: 'completed' } }),
    ]);

    const pendingPayouts = 0; // placeholder until payout module is ported

    // Revenue trend — group payments by date
    const payments = await this.prisma.payment.findMany({
      where: {
        status: 'completed',
        createdAt: { gte: start, lte: end },
      },
      select: { amount: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });

    const revenueTrendMap: Record<string, number> = {};
    const enrollmentTrendMap: Record<string, number> = {};
    for (const p of payments) {
      const dateStr = p.createdAt.toISOString().slice(0, 10);
      revenueTrendMap[dateStr] = (revenueTrendMap[dateStr] || 0) + (p.amount ? Number(p.amount) : 0);
      enrollmentTrendMap[dateStr] = (enrollmentTrendMap[dateStr] || 0) + 1;
    }

    const revenueTrend = Object.entries(revenueTrendMap).map(([date, revenue]) => ({ date, revenue }));
    const enrollmentTrend = Object.entries(enrollmentTrendMap).map(([date, students]) => ({ date, students }));

    // Recent activities
    const [recentUsers, recentCourses] = await Promise.all([
      this.prisma.user.findMany({
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { name: true, role: true, createdAt: true },
      }),
      this.prisma.course.findMany({
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { title: true, isPublished: true, createdAt: true },
      }),
    ]);

    const recentActivities = [
      ...recentUsers.map((u) => ({
        title: `New ${u.role} joined: ${u.name}`,
        type: 'user',
        timestamp: u.createdAt,
      })),
      ...recentCourses.map((c) => ({
        title: `${c.isPublished ? 'Published' : 'Created'} course: ${c.title}`,
        type: 'course',
        timestamp: c.createdAt,
      })),
    ]
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 10);

    // ─── Real aggregations (Task 13) ──────────────────────────────────────
    // Course trend: count enrollments per day
    const enrollments = await this.prisma.enrollment.findMany({
      where: { createdAt: { gte: start, lte: end } },
      select: { createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
    const courseTrendMap: Record<string, number> = {};
    for (const e of enrollments) {
      const dateStr = e.createdAt.toISOString().slice(0, 10);
      courseTrendMap[dateStr] = (courseTrendMap[dateStr] || 0) + 1;
    }
    const courseTrend = Object.entries(courseTrendMap).map(([date, count]) => ({ date, enrollments: count }));

    // Exam trend: pass rate per day
    const examResults = await this.prisma.examResult.findMany({
      where: { createdAt: { gte: start, lte: end } },
      select: { createdAt: true, passed: true },
      orderBy: { createdAt: 'asc' },
    });
    const examTrendMap: Record<string, { total: number; passed: number }> = {};
    for (const r of examResults) {
      const dateStr = r.createdAt.toISOString().slice(0, 10);
      if (!examTrendMap[dateStr]) examTrendMap[dateStr] = { total: 0, passed: 0 };
      examTrendMap[dateStr].total += 1;
      if (r.passed) examTrendMap[dateStr].passed += 1;
    }
    const examTrend = Object.entries(examTrendMap).map(([date, v]) => ({
      date,
      total: v.total,
      passed: v.passed,
      passRate: v.total > 0 ? Math.round((v.passed / v.total) * 100) : 0,
    }));

    // Tutor payout totals
    const tutorPayouts = await this.prisma.payment.aggregate({
      _sum: { amount: true },
      where: { status: 'completed', createdAt: { gte: start, lte: end } },
    });

    return {
      success: true,
      data: {
        totalStudents,
        totalUsers,
        totalCourses,
        totalRevenue: totalPayments._sum.amount ? Number(totalPayments._sum.amount) : 0,
        periodRevenue: tutorPayouts._sum.amount ? Number(tutorPayouts._sum.amount) : 0,
        pendingPayouts: 0,
        revenueTrend,
        enrollmentTrend,
        courseTrend,
        examTrend,
        recentActivities,
      },
    };
  }

  async getStudentPerformance() {
    const students = await this.prisma.user.findMany({
      where: { role: 'student' },
      select: { id: true, name: true, email: true },
    });

    const data = await Promise.all(
      students.map(async (student) => {
        const [coursesCompleted, examResults, paymentsAgg] = await Promise.all([
          this.prisma.enrollment.count({ where: { userId: student.id } }),
          this.prisma.examResult.findMany({
            where: { studentId: student.id },
            select: { score: true, maxScore: true },
          }),
          this.prisma.payment.aggregate({
            _sum: { amount: true },
            where: { userId: student.id, status: 'completed' },
          }),
        ]);

        const avgScore = examResults.length
          ? Math.round(
              examResults.reduce((sum, r) => sum + (r.maxScore ? (r.score / r.maxScore) * 100 : 0), 0) /
                examResults.length,
            )
          : 0;

        return {
          name: student.name,
          email: student.email,
          coursesCompleted,
          avgScore,
          totalSpent: paymentsAgg._sum.amount ? Number(paymentsAgg._sum.amount) : 0,
        };
      }),
    );

    return { success: true, data };
  }

  async getStudentDashboard(userId: number) {
    const [enrolledCount, payments, examResults, points] = await Promise.all([
      this.prisma.enrollment.count({ where: { userId } }),
      this.prisma.payment.findMany({
        where: { userId, status: 'completed' },
        include: { course: { select: { title: true } } },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
      this.prisma.examResult.findMany({
        where: { studentId: userId },
        include: { exam: { select: { title: true } } },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { points: true, walletBalance: true },
      }),
    ]);

    return {
      success: true,
      data: {
        feeRecords: payments,
        payments,
        enrolledCoursesCount: enrolledCount,
        totalPoints: points?.points || 0,
        walletBalance: points?.walletBalance || 0,
        recentExamResults: examResults,
      },
    };
  }
}
