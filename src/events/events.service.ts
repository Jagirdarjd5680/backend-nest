import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class EventsService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    return this.prisma.event.findMany({
      include: {
          bookings: true
      }
    });
  }

  async findOne(id: number) {
    const item = await this.prisma.event.findUnique({
      where: { id },
      include: {
          bookings: true
      }
    });
    if (!item) throw new NotFoundException(`Events with ID ${id} not found`);
    return item;
  }

  async create(data: any) {
    return this.prisma.event.create({ data });
  }

  async update(id: number, data: any) {
    await this.findOne(id);
    return this.prisma.event.update({ where: { id }, data });
  }

  async remove(id: number) {
    await this.findOne(id);
    return this.prisma.event.delete({ where: { id } });
  }
}
