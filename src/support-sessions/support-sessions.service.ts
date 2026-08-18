import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';

@Injectable()
export class SupportSessionsService {
  constructor(
    private prisma: PrismaService,
    private settingsService: SettingsService,
  ) {}

  private async getStudentTokenBalance(studentId: number): Promise<number> {
    const txs = await this.prisma.creditTransaction.findMany({ where: { userId: studentId } });
    const credits = txs.filter((t) => t.type === 'credit').reduce((sum, t) => sum + t.amount, 0);
    const debits = txs.filter((t) => t.type === 'debit').reduce((sum, t) => sum + t.amount, 0);
    return Math.max(0, credits - debits);
  }

  async findAll() {
    return this.prisma.supportSession.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: number) {
    const item = await this.prisma.supportSession.findUnique({ where: { id } });
    if (!item) throw new NotFoundException(`SupportSession with ID ${id} not found`);
    return item;
  }

  async create(data: any) {
    return this.prisma.supportSession.create({ data });
  }

  async update(id: number, data: any) {
    await this.findOne(id);
    return this.prisma.supportSession.update({ where: { id }, data });
  }

  async remove(id: number) {
    await this.findOne(id);
    return this.prisma.supportSession.delete({ where: { id } });
  }

  // ─── Step 4: Request & History Workflows ────────────────────────────────
  async getMyHistory(studentId: number) {
    const sessions = await this.prisma.supportSession.findMany({
      where: { studentId },
      orderBy: { createdAt: 'desc' },
    });
    return {
      success: true,
      data: sessions.map((s) => ({ ...s, _id: s.id.toString() })),
    };
  }

  async requestSession(studentId: number, tutorId: number, category?: string) {
    const tutor = await this.prisma.tutor.findUnique({ where: { id: tutorId } });
    if (!tutor) throw new NotFoundException('Tutor not found');

    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const activePending = await this.prisma.supportSession.findFirst({
      where: { studentId, tutorId, status: 'pending' },
    });
    if (activePending) {
      throw new BadRequestException('You already have a pending request for this tutor.');
    }

    const rejectionCount = await this.prisma.supportSession.count({
      where: {
        studentId,
        tutorId,
        status: 'rejected',
        createdAt: { gt: twentyFourHoursAgo },
      },
    });

    if (rejectionCount > 0) {
      throw new BadRequestException('Your recent request was rejected by this tutor. Please wait 24 hours before trying again.');
    }

    const newSession = await this.prisma.supportSession.create({
      data: {
        studentId,
        tutorId,
        status: 'pending',
      },
    });

    return {
      success: true,
      data: { ...newSession, _id: newSession.id.toString() },
      message: 'Support session requested successfully',
    };
  }

  async updateSessionStatus(sessionId: number, status: string, meetUrl?: string) {
    const session = await this.findOne(sessionId);
    const data: any = {
      status,
      ...(meetUrl ? { googleMeetLink: meetUrl } : {}),
    };

    // Snapshotted once, at acceptance — a later change to the tutor's per-session config
    // must not retroactively alter a session already in progress.
    if (status === 'accepted' && session.tokensCost == null) {
      const tutor = await this.prisma.tutor.findUnique({ where: { id: session.tutorId } });
      data.tokensCost = tutor?.tokensPerSession ?? 20;
      data.durationMinutes = tutor?.sessionDurationMinutes ?? 10;
    }

    // Tokens are only actually spent once the conversation is done, not merely accepted —
    // a session that's accepted but never happens shouldn't cost the student anything.
    if (status === 'completed' && session.studentId && session.earningApprovalStatus !== 'approved') {
      const tokensCost = session.tokensCost ?? 20;
      const balance = await this.getStudentTokenBalance(session.studentId);
      if (balance < tokensCost) {
        throw new BadRequestException(
          `Student has insufficient tokens (${balance} available, ${tokensCost} required) to complete this session.`,
        );
      }
      data.completedAt = new Date();
      await this.prisma.creditTransaction.create({
        data: {
          userId: session.studentId,
          amount: tokensCost,
          type: 'debit',
          description: `Tutor conversation #${session.id} (${session.durationMinutes ?? 10} min)`,
        },
      });
    }

    const updated = await this.prisma.supportSession.update({ where: { id: sessionId }, data });

    return {
      success: true,
      data: { ...updated, _id: updated.id.toString() },
      message: `Session status updated to ${status}`,
    };
  }

  /**
   * Converts a completed session's pending tokens into real, withdrawable tutor earnings.
   * Deliberately a separate, explicit admin action rather than automatic on completion — the
   * student's tokens are already spent at that point, but the payout itself needs a human
   * check before it becomes money the tutor can request a withdrawal against.
   */
  async approveEarning(sessionId: number) {
    const session = await this.findOne(sessionId);
    if (session.status !== 'completed') {
      throw new BadRequestException('Only completed sessions can have their earning approved.');
    }
    if (session.earningApprovalStatus === 'approved') {
      throw new BadRequestException('This session\'s earning has already been approved.');
    }

    const settings = await this.settingsService.getAllSettings();
    const tokenValueInRupees = Number(settings?.tutorSupport?.tokenValueInRupees) || 10;
    const payoutAmount = (session.tokensCost ?? 0) * tokenValueInRupees;

    const [updatedSession] = await this.prisma.$transaction([
      this.prisma.supportSession.update({ where: { id: sessionId }, data: { earningApprovalStatus: 'approved' } }),
      this.prisma.tutor.update({ where: { id: session.tutorId }, data: { earnings: { increment: payoutAmount } } }),
    ]);

    return {
      success: true,
      data: { ...updatedSession, _id: updatedSession.id.toString() },
      payoutAmount,
      message: `Approved — ₹${payoutAmount} added to tutor's withdrawable earnings.`,
    };
  }

  /** Sessions completed but awaiting admin approval — the tutor payout queue. */
  async getPendingEarnings() {
    const sessions = await this.prisma.supportSession.findMany({
      where: { status: 'completed', earningApprovalStatus: 'pending' },
      include: { tutor: { include: { user: true } } },
      orderBy: { completedAt: 'desc' },
    });
    const settings = await this.settingsService.getAllSettings();
    const tokenValueInRupees = Number(settings?.tutorSupport?.tokenValueInRupees) || 10;

    return {
      success: true,
      tokenValueInRupees,
      data: sessions.map((s) => ({
        ...s,
        _id: s.id.toString(),
        tutorName: s.tutor?.user?.name,
        estimatedPayout: (s.tokensCost ?? 0) * tokenValueInRupees,
      })),
    };
  }
}
