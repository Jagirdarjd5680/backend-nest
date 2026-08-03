import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ReferralJoinRequestsService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    return this.prisma.referralJoinRequest.findMany();
  }

  async findOne(id: number) {
    const item = await this.prisma.referralJoinRequest.findUnique({ where: { id } });
    if (!item) throw new NotFoundException(`ReferralJoinRequests with ID ${id} not found`);
    return item;
  }

  async create(data: any) {
    return this.prisma.referralJoinRequest.create({ data });
  }

  async update(id: number, data: any) {
    await this.findOne(id);
    return this.prisma.referralJoinRequest.update({ where: { id }, data });
  }

  async remove(id: number) {
    await this.findOne(id);
    return this.prisma.referralJoinRequest.delete({ where: { id } });
  }
}
