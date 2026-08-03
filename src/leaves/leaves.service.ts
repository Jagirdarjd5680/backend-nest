import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LeaveRequest } from '@prisma/client';
import { ExpoPushService } from '../notifications/expo-push.service';

@Injectable()
export class LeavesService {
  constructor(
    private prisma: PrismaService,
    private expoPushService: ExpoPushService,
  ) {}

  async findAll(): Promise<LeaveRequest[]> {
    return this.prisma.leaveRequest.findMany({
      include: {
        user: true,
      },
    });
  }

  async findOne(id: number): Promise<LeaveRequest> {
    const req = await this.prisma.leaveRequest.findUnique({
      where: { id },
      include: { user: true },
    });
    if (!req) throw new NotFoundException(`Leave request not found`);
    return req;
  }

  async create(data: any): Promise<LeaveRequest> {
    const startDate = new Date(data.startDate);
    const endDate = new Date(data.endDate);
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      throw new BadRequestException('Invalid startDate or endDate');
    }

    return this.prisma.leaveRequest.create({
      data: {
        startDate,
        endDate,
        reason: data.reason,
        userId: parseInt(data.userId),
      },
    });
  }

  async updateStatus(id: number, status: string, adminMessage?: string): Promise<LeaveRequest> {
    const existing = await this.findOne(id);
    const updated = await this.prisma.leaveRequest.update({
      where: { id },
      data: { status, adminMessage },
    });

    if (status !== existing.status) {
      const title = status === 'approved' ? 'Leave request approved' : status === 'rejected' ? 'Leave request rejected' : 'Leave request updated';
      const body = adminMessage || `Your leave request has been ${status}.`;
      this.expoPushService.sendToUser(existing.userId, title, body, { type: 'leave_status', leaveId: id }).catch(() => {});
    }

    return updated;
  }
}
