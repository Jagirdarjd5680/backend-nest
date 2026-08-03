import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CreditTransactionsService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    return this.prisma.creditTransaction.findMany({
      include: {
        user: true,
      },
    });
  }

  async findOne(id: number) {
    const item = await this.prisma.creditTransaction.findUnique({
      where: { id },
      include: {
        user: true,
      },
    });
    if (!item) throw new NotFoundException(`CreditTransactions with ID ${id} not found`);
    return item;
  }

  async create(data: any) {
    return this.prisma.creditTransaction.create({ data });
  }

  async update(id: number, data: any) {
    await this.findOne(id);
    return this.prisma.creditTransaction.update({ where: { id }, data });
  }

  async remove(id: number) {
    await this.findOne(id);
    return this.prisma.creditTransaction.delete({ where: { id } });
  }

  async findByUser(userId: number) {
    return this.prisma.creditTransaction.findMany({
      where: { userId },
      include: {
        user: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getBalance(userId: number) {
    const txs = await this.prisma.creditTransaction.findMany({
      where: { userId },
    });
    const credits = txs.filter((t) => t.type === 'credit').reduce((sum, t) => sum + t.amount, 0);
    const debits = txs.filter((t) => t.type === 'debit').reduce((sum, t) => sum + t.amount, 0);
    return Math.max(0, credits - debits);
  }

  async syncCredits(userId: number) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException(`User ${userId} not found`);

    const balance = await this.getBalance(userId);
    return {
      success: true,
      userId,
      syncedBalance: balance,
      message: 'User credit tokens synced successfully',
    };
  }
}
