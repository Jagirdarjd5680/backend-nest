import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class NewsTickerService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    return this.prisma.newsTicker.findMany();
  }

  async findOne(id: number) {
    const item = await this.prisma.newsTicker.findUnique({ where: { id } });
    if (!item) throw new NotFoundException(`NewsTicker with ID ${id} not found`);
    return item;
  }

  async create(data: any) {
    return this.prisma.newsTicker.create({ data });
  }

  async update(id: number, data: any) {
    await this.findOne(id);
    return this.prisma.newsTicker.update({ where: { id }, data });
  }

  async remove(id: number) {
    await this.findOne(id);
    return this.prisma.newsTicker.delete({ where: { id } });
  }
}
