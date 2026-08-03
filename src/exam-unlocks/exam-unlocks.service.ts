import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ExamUnlocksService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    return this.prisma.examUnlock.findMany({
      include: {
          student: true
      }
    });
  }

  async findOne(id: number) {
    const item = await this.prisma.examUnlock.findUnique({
      where: { id },
      include: {
          student: true
      }
    });
    if (!item) throw new NotFoundException(`ExamUnlocks with ID ${id} not found`);
    return item;
  }

  async create(data: any) {
    return this.prisma.examUnlock.create({ data });
  }

  async update(id: number, data: any) {
    await this.findOne(id);
    return this.prisma.examUnlock.update({ where: { id }, data });
  }

  async remove(id: number) {
    await this.findOne(id);
    return this.prisma.examUnlock.delete({ where: { id } });
  }
}
