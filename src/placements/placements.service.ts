import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PlacementsService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    return this.prisma.placement.findMany();
  }

  async findOne(id: number) {
    const item = await this.prisma.placement.findUnique({ where: { id } });
    if (!item) throw new NotFoundException(`Placements with ID ${id} not found`);
    return item;
  }

  async create(data: any) {
    return this.prisma.placement.create({ data });
  }

  async update(id: number, data: any) {
    await this.findOne(id);
    return this.prisma.placement.update({ where: { id }, data });
  }

  async remove(id: number) {
    await this.findOne(id);
    return this.prisma.placement.delete({ where: { id } });
  }
}
