import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CategoriesService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    try {
      const categories = await this.prisma.category.findMany({
        orderBy: { name: 'asc' },
      });
      const formatted = categories.map((c) => ({
        ...c,
        _id: c.id.toString(),
      }));
      return {
        success: true,
        count: formatted.length,
        data: formatted,
      };
    } catch (error) {
      return {
        success: true,
        count: 0,
        data: [],
      };
    }
  }

  async findOne(id: number) {
    const item = await this.prisma.category.findUnique({
      where: { id },
    });
    if (!item) throw new NotFoundException(`Category with ID ${id} not found`);
    return {
      success: true,
      data: { ...item, _id: item.id.toString() },
    };
  }

  async create(data: any) {
    const name = data.name;
    const slug = data.slug || name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const category = await this.prisma.category.create({
      data: { name, slug },
    });
    return {
      success: true,
      data: { ...category, _id: category.id.toString() },
    };
  }

  async update(id: number, data: any) {
    await this.findOne(id);
    const updateData: any = {};
    if (data.name) updateData.name = data.name;
    if (data.slug) updateData.slug = data.slug;
    const updated = await this.prisma.category.update({
      where: { id },
      data: updateData,
    });
    return {
      success: true,
      data: { ...updated, _id: updated.id.toString() },
    };
  }

  async remove(id: number) {
    await this.findOne(id);
    await this.prisma.category.delete({ where: { id } });
    return { success: true, message: 'Category deleted successfully' };
  }
}
