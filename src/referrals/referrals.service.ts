import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { ExpoPushService } from '../notifications/expo-push.service';
import { RealtimeService } from '../realtime/realtime.service';
import { REALTIME_EVENTS } from '../realtime/events';

/** "+919950925680" → "+91********80" (keeps the country code and last 2 digits). */
function maskPhone(phone?: string | null): string | null {
  const p = (phone || '').trim();
  if (!p) return null;
  const cc = p.startsWith('+') ? p.slice(0, 3) : '';
  const rest = p.slice(cc.length);
  return rest.length <= 2 ? cc + rest : `${cc}${'*'.repeat(rest.length - 2)}${rest.slice(-2)}`;
}

/** "purohitpraveen87@gmail.com" → "pu************@gmail.com". */
function maskEmail(email?: string | null): string | null {
  const e = (email || '').trim();
  const at = e.indexOf('@');
  if (at < 1) return null;
  const local = e.slice(0, at);
  return `${local.slice(0, 2)}${'*'.repeat(Math.max(local.length - 2, 3))}${e.slice(at)}`;
}

@Injectable()
export class ReferralsService {
  constructor(
    private prisma: PrismaService,
    private realtimeService: RealtimeService,
    private settingsService: SettingsService,
    private expoPushService: ExpoPushService,
  ) {}

  async getStats(userId: number) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    // Auto approve if user has referralCode
    if (!user.isReferralApproved && user.referralCode) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { isReferralApproved: true },
      });
      user.isReferralApproved = true;
    }

    if (!user.isReferralApproved) {
      const joinRequest = await this.prisma.referralJoinRequest.findFirst({
        where: { userId },
        orderBy: { createdAt: 'desc' },
      });
      return {
        success: true,
        data: {
          isApproved: false,
          joinRequestStatus: joinRequest ? joinRequest.status : 'none',
          adminMessage: joinRequest ? joinRequest.adminMessage || '' : '',
        },
      };
    }

    const referrals = await this.prisma.referral.findMany({
      where: { referrerId: userId },
      include: {
        referred: {
          select: { id: true, name: true, email: true, phone: true, createdAt: true, isDeleted: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const approvedReferrals = referrals.filter((r) => ['rewarded', 'purchased', 'approved'].includes(r.status));

    // What the student may see about the people they referred: the name and a masked phone /
    // email only — never the full contact details or anything else on that account.
    const referralList = referrals.map((r) => {
      const status = r.referred?.isDeleted
        ? 'deleted'
        : ['approved', 'rewarded', 'purchased'].includes(r.status)
          ? 'completed'
          : r.status === 'rejected'
            ? 'rejected'
            : 'process';
      return {
        id: r.id,
        _id: String(r.id),
        status,
        name: r.referred?.name || 'Student',
        phone: maskPhone(r.referred?.phone),
        email: maskEmail(r.referred?.email),
        points: r.rewardDistributed ? Math.round(r.rewardAmount || 0) : 0,
        referredAt: r.createdAt,
        joinedAt: r.referred?.createdAt ?? null,
      };
    });

    return {
      success: true,
      data: {
        isApproved: true,
        referralCode: user.referralCode,
        walletBalance: user.walletBalance,
        points: user.points || 0,
        rates: await this.settingsService.getReferralSettings(),
        totalReferrals: approvedReferrals.length,
        successfulReferrals: referrals.filter((r) => ['rewarded', 'purchased', 'approved'].includes(r.status)).length,
        referralList,
        // The student's own payout requests (points already deducted while "pending").
        withdrawals: (
          await this.prisma.withdrawRequest.findMany({
            where: { userId },
            orderBy: { createdAt: 'desc' },
            take: 30,
            select: { id: true, points: true, amount: true, upiId: true, status: true, adminNote: true, transactionId: true, createdAt: true },
          })
        ).map((w) => ({ ...w, _id: String(w.id) })),
      },
    };
  }

  async submitJoinRequest(userId: number) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (user.isReferralApproved) {
      throw new BadRequestException('You are already approved for the referral program');
    }

    const existing = await this.prisma.referralJoinRequest.findFirst({
      where: { userId, status: 'pending' },
    });
    if (existing) {
      throw new BadRequestException('You already have a pending request');
    }

    await this.prisma.referralJoinRequest.create({
      data: { userId },
    });

    return { success: true, message: 'Request submitted successfully' };
  }

  async getAdminJoinRequests() {
    const requests = await this.prisma.referralJoinRequest.findMany({
      include: {
        user: {
          select: { id: true, name: true, email: true, phone: true, createdAt: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return { success: true, data: requests };
  }

  async processJoinRequest(id: number, status: string, adminMessage?: string) {
    const request = await this.prisma.referralJoinRequest.findUnique({ where: { id } });
    if (!request) throw new NotFoundException('Request not found');

    await this.prisma.referralJoinRequest.update({
      where: { id },
      data: {
        status,
        adminMessage: adminMessage || '',
        processedAt: new Date(),
      },
    });

    if (status === 'approved') {
      const randomStr = Math.random().toString(36).substring(2, 6).toUpperCase();
      const user = await this.prisma.user.findUnique({ where: { id: request.userId } });
      const namePart = user?.name ? user.name.substring(0, 3).toUpperCase() : 'GOG';
      const code = `${namePart}${randomStr}`;

      await this.prisma.user.update({
        where: { id: request.userId },
        data: {
          isReferralApproved: true,
          referralCode: user?.referralCode || code,
        },
      });
    }

    return { success: true, message: `Request ${status} successfully` };
  }

  async getLeaderboard() {
    const grouped = await this.prisma.referral.groupBy({
      by: ['referrerId'],
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
      take: 10,
    });

    const userIds = grouped.map((g) => g.referrerId);
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true, avatar: true },
    });

    const leaderboard = grouped.map((g) => {
      const user = users.find((u) => u.id === g.referrerId);
      return {
        _id: g.referrerId,
        user: user || { name: 'Unknown', avatar: '' },
        count: g._count.id,
      };
    });

    return { success: true, data: leaderboard };
  }

  /**
   * Student asks to cash out points. The points leave their balance right away and sit in a
   * "pending" request until an admin pays (approve + screenshot) or rejects (points come back).
   */
  async submitWithdrawal(userId: number, _clientAmount: number, rawPoints: number, rawUpi: string) {
    const rules = await this.settingsService.getReferralSettings();
    const points = Math.floor(Number(rawPoints));
    const upiId = String(rawUpi || '').trim();
    if (!Number.isFinite(points) || points < rules.pointsUnit) {
      throw new BadRequestException(`Minimum ${rules.pointsUnit} points required for withdrawal`);
    }
    if (!/^[\w.\-]{2,}@[a-zA-Z][\w]{1,}$/.test(upiId)) {
      throw new BadRequestException('Enter a valid UPI ID (e.g. name@okaxis)');
    }

    // Rate from App Settings (e.g. 100 points = ₹10) — never trust a client-sent amount.
    const amount = Math.round(((points * rules.rupeesPerUnit) / rules.pointsUnit) * 100) / 100;

    const withdrawal = await this.prisma.$transaction(async (tx) => {
      // Conditional decrement: two quick taps can't both spend the same points.
      const taken = await tx.user.updateMany({ where: { id: userId, points: { gte: points } }, data: { points: { decrement: points } } });
      if (taken.count === 0) throw new BadRequestException('Insufficient points');
      return tx.withdrawRequest.create({ data: { userId, amount, points, upiId, status: 'pending' } });
    });

    this.realtimeService.emitToUser(userId, REALTIME_EVENTS.REFERRAL_UPDATED, { reason: 'withdrawal', status: 'pending' });
    return { success: true, data: withdrawal, message: 'Withdrawal request submitted — it will be paid to your UPI after review' };
  }


  async getMyWithdrawals(userId: number) {
    const withdrawals = await this.prisma.withdrawRequest.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    return { success: true, data: withdrawals };
  }

  async getAdminWithdrawals() {
    const withdrawals = await this.prisma.withdrawRequest.findMany({
      include: {
        user: {
          select: { id: true, name: true, email: true, phone: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    // Format _id string compatibility for frontend
    const formatted = withdrawals.map((w) => ({
      ...w,
      _id: w.id.toString(),
      user: {
        ...w.user,
        _id: w.user.id.toString(),
      },
    }));
    return { success: true, data: formatted };
  }

  /**
   * Admin pays a pending request outside the app (UPI), then approves it with the payment
   * screenshot (and the UTR if they have it) — or rejects it, which returns the points.
   * A request is processed once: approved / rejected requests can't be changed again.
   */
  async updateAdminWithdrawal(id: number, rawStatus: string, transactionId?: string, adminNote?: string, screenshot?: string) {
    const status = rawStatus === 'completed' ? 'approved' : rawStatus;
    if (!['approved', 'rejected'].includes(status)) throw new BadRequestException('Status must be approved or rejected');
    const withdrawal = await this.prisma.withdrawRequest.findUnique({ where: { id } });
    if (!withdrawal) throw new NotFoundException('Withdrawal request not found');
    if (withdrawal.status !== 'pending') throw new BadRequestException(`This request is already ${withdrawal.status}`);
    if (status === 'approved' && !screenshot) {
      throw new BadRequestException('Attach the payment screenshot to approve');
    }

    const data: any = {
      status,
      adminNote: adminNote?.trim() || null,
      ...(status === 'approved' ? { transactionId: transactionId?.trim() || '', screenshot } : {}),
    };
    const updated = await this.prisma.$transaction(async (tx) => {
      // Guarded on "still pending" so a double click can't refund twice.
      const changed = await tx.withdrawRequest.updateMany({ where: { id, status: 'pending' }, data });
      if (changed.count === 0) throw new BadRequestException('This request was already processed');
      if (status === 'rejected') {
        await tx.user.update({ where: { id: withdrawal.userId }, data: { points: { increment: withdrawal.points } } });
      }
      return tx.withdrawRequest.findUnique({ where: { id } });
    });

    this.realtimeService.emitToUser(withdrawal.userId, REALTIME_EVENTS.REFERRAL_UPDATED, { reason: 'withdrawal', status });
    const [title, body] =
      status === 'approved'
        ? ['Payout sent \u{1F4B8}', `₹${withdrawal.amount} for ${withdrawal.points} points was paid to ${withdrawal.upiId}.`]
        : ['Withdrawal rejected', `${withdrawal.points} points are back in your balance.${adminNote?.trim() ? ` Reason: ${adminNote.trim()}` : ''}`];
    this.expoPushService.sendToUser(withdrawal.userId, title, body, { type: 'withdrawal', status }).catch(() => {});

    return { success: true, data: updated, message: status === 'approved' ? 'Payout marked as paid' : 'Request rejected — points returned' };
  }


  async getAdminAllReferrals() {
    const referrals = await this.prisma.referral.findMany({
      include: {
        referrer: {
          select: { id: true, name: true, email: true, phone: true, rollNumber: true, avatar: true, isDeleted: true },
        },
        referred: {
          select: { id: true, name: true, email: true, phone: true, rollNumber: true, avatar: true, createdAt: true, isDeleted: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const formatted = referrals.map((r) => ({
      ...r,
      _id: r.id.toString(),
      referrer: r.referrer ? { ...r.referrer, _id: r.referrer.id.toString() } : null,
      referredUser: r.referred ? { ...r.referred, _id: r.referred.id.toString() } : null,
      updatedAt: r.createdAt,
    }));

    return { success: true, data: formatted };
  }

  async getAdminUserReferrals(userId: number) {
    const person = { select: { id: true, name: true, phone: true, email: true, avatar: true } } as const;
    const [user, made, referredBy, joinRequests, withdrawals, rules] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, referralCode: true, isReferralApproved: true, points: true, walletBalance: true } }),
      this.prisma.referral.findMany({ where: { referrerId: userId }, orderBy: { createdAt: 'desc' }, include: { referred: person } }),
      this.prisma.referral.findFirst({ where: { referredId: userId }, include: { referrer: person } }),
      this.prisma.referralJoinRequest.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } }),
      this.prisma.withdrawRequest.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } }),
      this.settingsService.getReferralSettings(),
    ]);
    if (!user) throw new NotFoundException('User not found');
    const completed = made.filter((r) => ['approved', 'rewarded'].includes(r.status));
    return {
      success: true,
      data: {
        ...user,
        rates: rules,
        pointsValue: Math.round(((user.points || 0) * rules.rupeesPerUnit) / rules.pointsUnit * 100) / 100,
        stats: {
          total: made.length,
          completed: completed.length,
          pending: made.filter((r) => r.status === 'pending').length,
          rejected: made.filter((r) => r.status === 'rejected').length,
          pointsEarned: completed.reduce((s, r) => s + Math.round(r.rewardAmount || 0), 0),
          withdrawn: withdrawals.filter((w) => w.status === 'approved' || w.status === 'completed' || w.status === 'paid').reduce((s, w) => s + w.amount, 0),
        },
        referralsMade: made,
        referredBy,
        joinRequests,
        withdrawals,
      },
    };
  }

  async getAdminReferralDetails(id: number) {
    const userSelect = {
      id: true, name: true, email: true, phone: true, rollNumber: true, avatar: true, createdAt: true,
      referralCode: true, walletBalance: true, points: true, isActive: true, isDeleted: true, isBlocked: true,
    } as const;
    const r = await this.prisma.referral.findUnique({
      where: { id },
      include: { referrer: { select: userSelect }, referred: { select: userSelect } },
    });
    if (!r) throw new NotFoundException('Referral record not found');

    const [joinRequests, payments, enrollments, referrerReferrals] = await Promise.all([
      this.prisma.referralJoinRequest.findMany({ where: { userId: r.referredId }, orderBy: { createdAt: 'asc' } }),
      this.prisma.payment.findMany({
        where: { userId: r.referredId },
        orderBy: { createdAt: 'asc' },
        select: { id: true, amount: true, discountAmount: true, couponCode: true, status: true, razorpayPaymentId: true, createdAt: true, course: { select: { id: true, title: true } } },
      }),
      this.prisma.enrollment.findMany({
        where: { userId: r.referredId },
        orderBy: { createdAt: 'asc' },
        select: { id: true, createdAt: true, course: { select: { id: true, title: true, price: true } } },
      }),
      this.prisma.referral.findMany({
        where: { referrerId: r.referrerId },
        orderBy: { createdAt: 'desc' },
        select: { id: true, status: true, rewardAmount: true, rewardDistributed: true, createdAt: true, referred: { select: { id: true, name: true, phone: true } } },
      }),
    ]);

    const firstPaid = payments.find((p) => p.status === 'completed');
    const timeline = [
      { at: r.referred?.createdAt, label: `${r.referred?.name ?? 'Joinee'} created an account` },
      { at: r.createdAt, label: `Referral recorded — ${r.referrer?.name ?? 'referrer'} → ${r.referred?.name ?? 'joinee'}` },
      ...joinRequests.map((j) => ({ at: j.createdAt, label: `Join request sent (${j.status})` })),
      ...joinRequests.filter((j) => j.processedAt).map((j) => ({ at: j.processedAt, label: `Join request ${j.status}${j.adminMessage ? ` — ${j.adminMessage}` : ''}` })),
      ...payments.map((p) => ({ at: p.createdAt, label: `Payment ${p.status}: ₹${p.amount}${p.course ? ` for ${p.course.title.trim()}` : ''}` })),
      ...enrollments.map((e) => ({ at: e.createdAt, label: `Enrolled in ${e.course?.title?.trim() ?? 'a course'}` })),
      ...(r.rewardDistributed || r.status === 'rewarded' ? [{ at: firstPaid?.createdAt ?? null, label: r.status === 'rewarded' ? `Reward ₹${r.rewardAmount} credited to ${r.referrer?.name ?? 'referrer'}'s wallet` : `${Math.round(r.rewardAmount || 0)} points to ${r.referrer?.name ?? 'referrer'}, ${r.points || 0} points to ${r.referred?.name ?? 'the new student'}` }] : []),
    ]
      .filter((t) => t.at)
      .sort((a, b) => new Date(a.at as any).getTime() - new Date(b.at as any).getTime());

    const hours = firstPaid ? Math.round((firstPaid.createdAt.getTime() - r.createdAt.getTime()) / 36e5) : null;
    return {
      success: true,
      data: {
        ...r,
        _id: String(r.id),
        referredUser: r.referred,
        joinRequests,
        payments,
        enrollments,
        referrerReferrals,
        rates: await this.settingsService.getReferralSettings(),
        stats: {
          totalSpent: payments.filter((p) => p.status === 'completed').reduce((s, p) => s + p.amount, 0),
          referrerTotal: referrerReferrals.length,
          referrerRewarded: referrerReferrals.filter((x) => x.status === 'rewarded').reduce((s, x) => s + (x.rewardAmount || 0), 0),
          referrerPoints: referrerReferrals.filter((x) => x.rewardDistributed && x.status !== 'rewarded').reduce((s, x) => s + Math.round(x.rewardAmount || 0), 0),
          hoursToFirstPurchase: hours,
        },
        timeline,
      },
    };
  }

  /**
   * Admin sets a referral to one of three states (from /referral-records):
   *  - pending  ("Process")   — waiting, nobody gets anything yet
   *  - approved ("Completed") — referrer + new student get the points set in App Settings
   *  - rejected               — no points
   * Moving a completed referral back to pending/rejected takes those points back.
   */
  async processReferralRecord(id: number, rawStatus: string) {
    const status = ({ completed: 'approved', complete: 'approved', process: 'pending', processing: 'pending', in_progress: 'pending' } as Record<string, string>)[rawStatus] ?? rawStatus;
    if (!['pending', 'approved', 'rejected'].includes(status)) {
      throw new BadRequestException('Status must be pending (process), completed or rejected');
    }
    const referral = await this.prisma.referral.findUnique({ where: { id } });
    if (!referral) throw new NotFoundException('Referral record not found');
    if (referral.status === 'rewarded') {
      throw new BadRequestException('This referral was paid into the wallet by the old automatic reward and can no longer be changed');
    }
    if (referral.status === status) return { success: true, message: 'Status unchanged' };

    const ops: any[] = [];
    let data: any = { status };
    if (status === 'approved' && !referral.rewardDistributed) {
      const rules = await this.settingsService.getReferralSettings();
      ops.push(
        this.prisma.user.update({ where: { id: referral.referrerId }, data: { points: { increment: rules.referrerPoints } } }),
        this.prisma.user.update({ where: { id: referral.referredId }, data: { points: { increment: rules.newUserPoints } } }),
      );
      data = { ...data, rewardDistributed: true, rewardAmount: rules.referrerPoints, points: rules.newUserPoints };
    } else if (status !== 'approved' && referral.rewardDistributed) {
      // Undo exactly what was given (never below zero if some was already withdrawn).
      const users = await this.prisma.user.findMany({ where: { id: { in: [referral.referrerId, referral.referredId] } }, select: { id: true, points: true } });
      const pts = new Map(users.map((u) => [u.id, u.points || 0]));
      ops.push(
        this.prisma.user.update({ where: { id: referral.referrerId }, data: { points: Math.max(0, (pts.get(referral.referrerId) ?? 0) - Math.round(referral.rewardAmount || 0)) } }),
        this.prisma.user.update({ where: { id: referral.referredId }, data: { points: Math.max(0, (pts.get(referral.referredId) ?? 0) - (referral.points || 0)) } }),
      );
      data = { ...data, rewardDistributed: false };
    }
    ops.push(this.prisma.referral.update({ where: { id }, data }));
    await this.prisma.$transaction(ops);

    this.realtimeService.emitToUser(referral.referrerId, REALTIME_EVENTS.REFERRAL_UPDATED, { reason: 'referral_processed', status });
    this.realtimeService.emitToUser(referral.referredId, REALTIME_EVENTS.REFERRAL_UPDATED, { reason: 'referral_processed', status });

    const label = status === 'approved' ? 'completed — points credited' : status === 'rejected' ? 'rejected' : 'moved back to process';
    return { success: true, message: `Referral ${label}` };
  }


  async findAll() {
    return this.prisma.referral.findMany({
      include: { referrer: true, referred: true },
    });
  }

  async findOne(id: number) {
    const item = await this.prisma.referral.findUnique({
      where: { id },
      include: { referrer: true, referred: true },
    });
    if (!item) throw new NotFoundException(`Referrals with ID ${id} not found`);
    return item;
  }

  async create(data: any) {
    return this.prisma.referral.create({ data });
  }

  async update(id: number, data: any) {
    await this.findOne(id);
    return this.prisma.referral.update({ where: { id }, data });
  }

  async remove(id: number) {
    await this.findOne(id);
    return this.prisma.referral.delete({ where: { id } });
  }
}
