import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ResumesService {
  constructor(private prisma: PrismaService) {}

  /** Every row, or only one user's when `userId` is given. */
  async findAll(userId?: number) {
    return this.prisma.resume.findMany({
      where: userId != null ? { userId } : undefined,
      include: {
          user: true
      }
    });
  }

  async findOne(id: number) {
    const item = await this.prisma.resume.findUnique({
      where: { id },
      include: {
          user: true
      }
    });
    if (!item) throw new NotFoundException(`Resumes with ID ${id} not found`);
    return item;
  }

  async create(data: any) {
    return this.prisma.resume.create({ data });
  }

  async update(id: number, data: any) {
    await this.findOne(id);
    return this.prisma.resume.update({ where: { id }, data });
  }

  async remove(id: number) {
    await this.findOne(id);
    return this.prisma.resume.delete({ where: { id } });
  }
}
