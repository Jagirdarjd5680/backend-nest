import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AppReviewsService {
  constructor(private prisma: PrismaService) {}

  async findAll(query?: { status?: string }) {
    const status = query?.status || 'active';
    return this.prisma.appReview.findMany({
      where: { status },
      orderBy: { createdAt: 'desc' },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            avatar: true,
          },
        },
      },
    });
  }

  async findOne(id: number) {
    const item = await this.prisma.appReview.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            avatar: true,
          },
        },
      },
    });
    if (!item) throw new NotFoundException(`AppReviews with ID ${id} not found`);
    return item;
  }

  async create(data: any) {
    return this.prisma.appReview.create({
      data,
    });
  }

  async update(id: number, data: any) {
    await this.findOne(id);
    return this.prisma.appReview.update({
      where: { id },
      data,
    });
  }

  async remove(id: number) {
    await this.findOne(id);
    return this.prisma.appReview.delete({
      where: { id },
    });
  }
}
