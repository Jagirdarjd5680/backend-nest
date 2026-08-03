import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class WithdrawRequestsService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    return this.prisma.withdrawRequest.findMany({
      include: {
        user: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: number) {
    const item = await this.prisma.withdrawRequest.findUnique({
      where: { id },
      include: {
        user: true,
      },
    });
    if (!item) throw new NotFoundException(`WithdrawRequest with ID ${id} not found`);
    return item;
  }

  async create(data: any) {
    return this.prisma.withdrawRequest.create({ data });
  }

  async update(id: number, data: any) {
    await this.findOne(id);
    return this.prisma.withdrawRequest.update({ where: { id }, data });
  }

  async remove(id: number) {
    await this.findOne(id);
    return this.prisma.withdrawRequest.delete({ where: { id } });
  }

  // ─── Step 6: Approval & Rejection with Proof Attachment ────────────────
  async approveWithdrawal(id: number, proofScreenshotUrl?: string) {
    const req = await this.findOne(id);
    if (req.status !== 'pending') throw new BadRequestException(`Withdrawal request is already ${req.status}`);

    const updated = await this.prisma.withdrawRequest.update({
      where: { id },
      data: {
        status: 'approved',
        ...(proofScreenshotUrl ? { screenshotUrl: proofScreenshotUrl } : {}),
      },
    });

    // Deduct user wallet balance
    await this.prisma.user.update({
      where: { id: req.userId },
      data: { walletBalance: { decrement: req.amount } },
    });

    return { success: true, data: updated, message: 'Withdrawal approved successfully' };
  }

  async rejectWithdrawal(id: number, adminMessage?: string) {
    const req = await this.findOne(id);
    if (req.status !== 'pending') throw new BadRequestException(`Withdrawal request is already ${req.status}`);

    const updated = await this.prisma.withdrawRequest.update({
      where: { id },
      data: {
        status: 'rejected',
        ...(adminMessage ? { adminMessage } : {}),
      },
    });

    return { success: true, data: updated, message: 'Withdrawal request rejected' };
  }
}
