import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class BannersService {
  constructor(private prisma: PrismaService) {}

  async findAll(query?: { status?: string; page?: number; limit?: number }) {
    const status = query?.status;
    const page = Math.max(1, query?.page || 1);
    const limit = Math.max(1, query?.limit || 20);
    const skip = (page - 1) * limit;

    const where: any = {};
    if (status) {
      where.status = status;
    }

    const [total, banners] = await this.prisma.$transaction([
      this.prisma.banner.count({ where }),
      this.prisma.banner.findMany({
        where,
        orderBy: [
          { order: 'asc' },
          { createdAt: 'desc' },
        ],
        skip,
        take: limit,
        include: {
          createdBy: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      }),
    ]);

    return { total, banners };
  }

  async findPublic() {
    return this.prisma.banner.findMany({
      where: {
        status: 'published',
        isActive: true,
      },
      orderBy: {
        order: 'asc',
      },
    });
  }

  async findOne(id: number) {
    const item = await this.prisma.banner.findUnique({
      where: { id },
      include: {
        createdBy: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });
    if (!item) throw new NotFoundException(`Banners with ID ${id} not found`);
    return item;
  }

  async create(data: any) {
    return this.prisma.banner.create({
      data,
    });
  }

  async update(id: number, data: any) {
    await this.findOne(id);
    return this.prisma.banner.update({
      where: { id },
      data,
    });
  }

  async remove(id: number) {
    await this.findOne(id);
    return this.prisma.banner.delete({
      where: { id },
    });
  }
}
