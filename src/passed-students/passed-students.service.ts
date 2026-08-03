import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PassedStudentsService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    const students = await this.prisma.passedStudent.findMany({
      where: { isPublished: true, showInApp: true },
      orderBy: { createdAt: 'desc' },
    });
    return students.map((s) => this.format(s));
  }

  async findAllAdmin() {
    const students = await this.prisma.passedStudent.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return students.map((s) => this.format(s));
  }

  private format(s: any) {
    return {
      ...s,
      _id: s.id.toString(),
      images: s.images || [],
      videos: s.videos || [],
    };
  }

  async findOne(id: number) {
    const item = await this.prisma.passedStudent.findUnique({ where: { id } });
    if (!item) throw new NotFoundException(`PassedStudents with ID ${id} not found`);
    return item;
  }

  async create(data: any) {
    return this.prisma.passedStudent.create({ data });
  }

  async update(id: number, data: any) {
    await this.findOne(id);
    return this.prisma.passedStudent.update({ where: { id }, data });
  }

  async remove(id: number) {
    await this.findOne(id);
    return this.prisma.passedStudent.delete({ where: { id } });
  }
}
