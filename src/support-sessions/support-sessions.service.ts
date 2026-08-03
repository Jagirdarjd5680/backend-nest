import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SupportSessionsService {
  constructor(private prisma: PrismaService) {}

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

    const updated = await this.prisma.supportSession.update({
      where: { id: sessionId },
      data: {
        status,
        ...(meetUrl ? { googleMeetLink: meetUrl } : {}),
      },
    });

    // If accepted/completed, create credit debit record
    if ((status === 'accepted' || status === 'completed') && session.studentId) {
      await this.prisma.creditTransaction.create({
        data: {
          userId: session.studentId,
          amount: 1,
          type: 'debit',
          description: `Support session #${session.id} with tutor #${session.tutorId}`,
        },
      });
    }

    return {
      success: true,
      data: { ...updated, _id: updated.id.toString() },
      message: `Session status updated to ${status}`,
    };
  }
}
