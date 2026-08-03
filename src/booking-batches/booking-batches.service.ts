import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class BookingBatchesService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    return this.prisma.bookingBatch.findMany({
      include: {
          user: true,
          batch: true
      }
    });
  }

  async findOne(id: number) {
    const item = await this.prisma.bookingBatch.findUnique({
      where: { id },
      include: {
          user: true,
          batch: true
      }
    });
    if (!item) throw new NotFoundException(`BookingBatches with ID ${id} not found`);
    return item;
  }

  async create(data: any) {
    return this.prisma.bookingBatch.create({ data });
  }

  async update(id: number, data: any) {
    await this.findOne(id);
    return this.prisma.bookingBatch.update({ where: { id }, data });
  }

  async remove(id: number) {
    await this.findOne(id);
    return this.prisma.bookingBatch.delete({ where: { id } });
  }
}
