import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class FreeMaterialsService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    return this.prisma.freeMaterial.findMany();
  }

  async findOne(id: number) {
    const item = await this.prisma.freeMaterial.findUnique({ where: { id } });
    if (!item) throw new NotFoundException(`FreeMaterials with ID ${id} not found`);
    return item;
  }

  async create(data: any) {
    return this.prisma.freeMaterial.create({ data });
  }

  async update(id: number, data: any) {
    await this.findOne(id);
    return this.prisma.freeMaterial.update({ where: { id }, data });
  }

  async remove(id: number) {
    await this.findOne(id);
    return this.prisma.freeMaterial.delete({ where: { id } });
  }
}
