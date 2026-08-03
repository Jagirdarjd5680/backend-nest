import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { REALTIME_EVENTS } from '../realtime/events';

@Injectable()
export class ReferralsService {
  constructor(
    private prisma: PrismaService,
    private realtimeService: RealtimeService,
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
          select: { id: true, name: true, email: true, createdAt: true, avatar: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const approvedReferrals = referrals.filter((r) => ['rewarded', 'purchased', 'approved'].includes(r.status));

    return {
      success: true,
      data: {
        isApproved: true,
        referralCode: user.referralCode,
        walletBalance: user.walletBalance,
        points: user.points || 0,
        totalReferrals: approvedReferrals.length,
        successfulReferrals: referrals.filter((r) => ['rewarded', 'purchased'].includes(r.status)).length,
        referralList: referrals,
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

  async submitWithdrawal(userId: number, amount: number, points: number, upiId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    if (user.points < 100 || points < 100) {
      throw new BadRequestException('Minimum 100 points required for withdrawal');
    }

    if (user.points < points) {
      throw new BadRequestException('Insufficient points');
    }

    const calculatedAmount = amount || points / 10;

    const withdrawal = await this.prisma.withdrawRequest.create({
      data: {
        userId,
        amount: calculatedAmount,
        points,
        upiId: upiId || '',
        status: 'pending',
      },
    });

    await this.prisma.user.update({
      where: { id: userId },
      data: { points: user.points - points },
    });

    return { success: true, data: withdrawal, message: 'Withdrawal request submitted successfully' };
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

  async updateAdminWithdrawal(id: number, status: string, transactionId?: string, adminNote?: string, screenshot?: string) {
    const withdrawal = await this.prisma.withdrawRequest.findUnique({ where: { id } });
    if (!withdrawal) throw new NotFoundException('Withdrawal request not found');

    const updateData: any = { status };
    if (status === 'approved') {
      if (transactionId) updateData.transactionId = transactionId;
      if (screenshot) updateData.screenshot = screenshot;
    } else if (status === 'rejected') {
      if (adminNote) updateData.adminNote = adminNote;

      const user = await this.prisma.user.findUnique({ where: { id: withdrawal.userId } });
      if (user) {
        await this.prisma.user.update({
          where: { id: user.id },
          data: { points: user.points + withdrawal.points },
        });
      }
    }

    const updated = await this.prisma.withdrawRequest.update({
      where: { id },
      data: updateData,
    });

    this.realtimeService.emitToUser(withdrawal.userId, REALTIME_EVENTS.REFERRAL_UPDATED, { reason: 'withdrawal', status });

    return { success: true, data: updated, message: `Withdrawal ${status}` };
  }

  async getAdminAllReferrals() {
    const referrals = await this.prisma.referral.findMany({
      include: {
        referrer: {
          select: { id: true, name: true, email: true, phone: true, rollNumber: true, avatar: true },
        },
        referred: {
          select: { id: true, name: true, email: true, phone: true, rollNumber: true, avatar: true, createdAt: true },
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

  async processReferralRecord(id: number, status: string) {
    const referral = await this.prisma.referral.findUnique({ where: { id } });
    if (!referral) throw new NotFoundException('Referral record not found');

    if (referral.status === 'rewarded' || referral.status === 'approved') {
      throw new BadRequestException('Referral already processed');
    }

    if (status === 'approved') {
      const referrer = await this.prisma.user.findUnique({ where: { id: referral.referrerId } });
      if (referrer) {
        await this.prisma.user.update({
          where: { id: referrer.id },
          data: { points: (referrer.points || 0) + (referral.rewardAmount || 10) },
        });
      }

      const referredUser = await this.prisma.user.findUnique({ where: { id: referral.referredId } });
      if (referredUser) {
        await this.prisma.user.update({
          where: { id: referredUser.id },
          data: { points: (referredUser.points || 0) + 10 },
        });
      }

      await this.prisma.referral.update({
        where: { id },
        data: {
          status: 'approved',
          rewardDistributed: true,
        },
      });
    } else if (status === 'rejected') {
      await this.prisma.referral.update({
        where: { id },
        data: { status: 'rejected' },
      });
    }

    this.realtimeService.emitToUser(referral.referrerId, REALTIME_EVENTS.REFERRAL_UPDATED, { reason: 'referral_processed', status });

    return { success: true, message: `Referral ${status} successfully` };
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
