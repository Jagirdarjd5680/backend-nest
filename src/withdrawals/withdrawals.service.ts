import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class WithdrawalsService {
  constructor(private prisma: PrismaService) {}

  async findAll(status?: string) {
    const list = await this.prisma.withdrawal.findMany({
      where: status ? { status } : undefined,
      include: {
        tutor: {
          include: {
            user: true,
          },
        },
      },
    });

    return list.map((w) => ({
      ...w,
      _id: w.id,
      tutor: w.tutor ? {
        ...w.tutor,
        _id: w.tutor.id,
        name: w.tutor.user?.name || '',
      } : null,
    }));
  }

  async findOne(id: number) {
    const item = await this.prisma.withdrawal.findUnique({
      where: { id },
      include: {
        tutor: {
          include: {
            user: true,
          },
        },
      },
    });
    if (!item) throw new NotFoundException(`Withdrawals with ID ${id} not found`);
    return {
      ...item,
      _id: item.id,
      tutor: item.tutor ? {
        ...item.tutor,
        _id: item.tutor.id,
        name: item.tutor.user?.name || '',
      } : null,
    };
  }

  async create(data: any) {
    const { amount, tutorId, upiId } = data;
    return this.prisma.withdrawal.create({
      data: {
        amount: parseFloat(amount),
        tutorId: parseInt(tutorId, 10),
        upiId: upiId || '',
        status: 'pending',
      },
    });
  }

  async update(id: number, data: any) {
    await this.findOne(id);
    return this.prisma.withdrawal.update({ where: { id }, data });
  }

  async updateAdminWithdrawal(id: number, data: any) {
    const { status, transactionId, adminNote, proofImage } = data;
    const item = await this.prisma.withdrawal.findUnique({
      where: { id },
    });
    if (!item) throw new NotFoundException(`Withdrawal request ${id} not found`);

    const updated = await this.prisma.withdrawal.update({
      where: { id },
      data: {
        status,
        transactionId: transactionId || '',
        adminNote: adminNote || '',
        proofImage: proofImage || '',
      },
    });

    if (status === 'approved' && item.status !== 'approved') {
      await this.prisma.tutor.update({
        where: { id: item.tutorId },
        data: {
          earnings: {
            decrement: item.amount,
          },
        },
      });
    }

    return updated;
  }

  async remove(id: number) {
    await this.findOne(id);
    return this.prisma.withdrawal.delete({ where: { id } });
  }
}
