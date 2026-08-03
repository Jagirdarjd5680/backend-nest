import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class TicketsService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    return this.prisma.ticket.findMany({
      include: {
          user: true
      }
    });
  }

  async findOne(id: number) {
    const item = await this.prisma.ticket.findUnique({
      where: { id },
      include: {
          user: true
      }
    });
    if (!item) throw new NotFoundException(`Tickets with ID ${id} not found`);
    return item;
  }

  async create(data: any) {
    return this.prisma.ticket.create({ data });
  }

  async update(id: number, data: any) {
    await this.findOne(id);
    return this.prisma.ticket.update({ where: { id }, data });
  }

  async remove(id: number) {
    await this.findOne(id);
    return this.prisma.ticket.delete({ where: { id } });
  }
}
