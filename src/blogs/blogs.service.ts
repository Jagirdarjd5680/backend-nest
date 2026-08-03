import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class BlogsService {
  constructor(private prisma: PrismaService) {}

  async findAll(options: { search?: string; status?: string; limit?: number } = {}) {
    const { search, status, limit } = options;
    return this.prisma.blog.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(search
          ? {
              OR: [
                { title: { contains: search } },
                { excerpt: { contains: search } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit || undefined,
    });
  }

  async findOne(id: number) {
    const item = await this.prisma.blog.findUnique({ where: { id } });
    if (!item) throw new NotFoundException(`Blogs with ID ${id} not found`);
    return item;
  }

  async create(data: any, authorName: string) {
    return this.prisma.blog.create({ data: { ...data, author: authorName } });
  }

  async update(id: number, data: any) {
    await this.findOne(id);
    return this.prisma.blog.update({ where: { id }, data });
  }

  async remove(id: number) {
    await this.findOne(id);
    return this.prisma.blog.delete({ where: { id } });
  }
}
