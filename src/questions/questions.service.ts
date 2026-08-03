import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class QuestionsService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    return this.prisma.question.findMany({ where: { isDeleted: false } });
  }

  async findOne(id: number) {
    const item = await this.prisma.question.findUnique({ where: { id } });
    if (!item) throw new NotFoundException(`Questions with ID ${id} not found`);
    return item;
  }

  async create(data: any) {
    return this.prisma.question.create({ data });
  }

  async update(id: number, data: any) {
    await this.findOne(id);
    return this.prisma.question.update({ where: { id }, data });
  }

  async remove(id: number) {
    await this.findOne(id);
    return this.prisma.question.update({ where: { id }, data: { isDeleted: true } });
  }

  async getBinCount(): Promise<number> {
    return this.prisma.question.count({ where: { isDeleted: true } });
  }

  async getBinAll(): Promise<any[]> {
    const questions = await this.prisma.question.findMany({
      where: { isDeleted: true },
      orderBy: { createdAt: 'desc' },
    });
    return questions.map((q) => ({
      _id: q.id.toString(),
      content: q.text,
      type: 'MCQ',
      category: q.category,
    }));
  }

  async restoreQuestion(id: number) {
    return this.prisma.question.update({
      where: { id },
      data: { isDeleted: false },
    });
  }

  async permanentDelete(id: number) {
    return this.prisma.question.delete({ where: { id } });
  }
}
