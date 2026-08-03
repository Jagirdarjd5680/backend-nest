import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class BatchesService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    try {
      const batches = await this.prisma.batch.findMany({
        include: {
          course: {
            select: { id: true, title: true, price: true },
          },
          attendances: true,
        },
        orderBy: { createdAt: 'desc' },
      });

      const formatted = await Promise.all(
        batches.map(async (batch) => {
          const studentCount = await this.prisma.user.count({
            where: {
              role: 'student',
              isDeleted: false,
              attendances: {
                some: { batchId: batch.id },
              },
            },
          });

          return {
            ...batch,
            _id: batch.id.toString(),
            course: batch.course ? { ...batch.course, _id: batch.course.id.toString() } : null,
            studentCount: Math.max(studentCount, batch.maxStudents ? 0 : 0),
          };
        }),
      );

      return {
        success: true,
        data: formatted,
      };
    } catch (error) {
      return {
        success: false,
        message: error.message || 'Failed to fetch batches',
        data: [],
      };
    }
  }

  async findOne(id: number) {
    const batch = await this.prisma.batch.findUnique({
      where: { id },
      include: {
        course: {
          select: { id: true, title: true, price: true },
        },
      },
    });

    if (!batch) {
      throw new NotFoundException(`Batch with ID ${id} not found`);
    }

    const studentCount = await this.prisma.user.count({
      where: {
        role: 'student',
        isDeleted: false,
        attendances: {
          some: { batchId: batch.id },
        },
      },
    });

    const formatted = {
      ...batch,
      _id: batch.id.toString(),
      course: batch.course ? { ...batch.course, _id: batch.course.id.toString() } : null,
      studentCount,
    };

    return {
      success: true,
      data: formatted,
    };
  }

  async getStudents(id: number) {
    await this.findOne(id);
    const students = await this.prisma.user.findMany({
      where: {
        role: 'student',
        isDeleted: false,
        attendances: {
          some: { batchId: id },
        },
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        rollNumber: true,
        avatar: true,
        createdAt: true,
      },
    });

    const formatted = students.map((s) => ({
      ...s,
      _id: s.id.toString(),
    }));

    return {
      success: true,
      count: formatted.length,
      data: formatted,
    };
  }

  async create(data: any) {
    const courseId = parseInt(data.courseId || data.course, 10);
    if (!courseId || isNaN(courseId)) {
      throw new BadRequestException('A valid Course is required to create a batch');
    }

    const startDate = data.startDate ? new Date(data.startDate) : new Date();
    const endDate = data.endDate ? new Date(data.endDate) : null;

    const batch = await this.prisma.batch.create({
      data: {
        name: data.name,
        timing: data.timing || '10:00 AM - 12:00 PM',
        startDate,
        endDate,
        maxStudents: parseInt(data.maxStudents, 10) || 50,
        isActive: data.isActive ?? true,
        courseId,
      },
      include: {
        course: {
          select: { id: true, title: true },
        },
      },
    });

    const formatted = {
      ...batch,
      _id: batch.id.toString(),
      course: batch.course ? { ...batch.course, _id: batch.course.id.toString() } : null,
      studentCount: 0,
    };

    return {
      success: true,
      data: formatted,
      message: 'Batch created successfully',
    };
  }

  async update(id: number, data: any) {
    await this.findOne(id);

    const updateData: any = {};
    if (data.name) updateData.name = data.name;
    if (data.timing) updateData.timing = data.timing;
    if (data.startDate) updateData.startDate = new Date(data.startDate);
    if (data.endDate) updateData.endDate = new Date(data.endDate);
    if (data.maxStudents !== undefined) updateData.maxStudents = parseInt(data.maxStudents, 10);
    if (data.isActive !== undefined) updateData.isActive = data.isActive;

    if (data.courseId || data.course) {
      const courseId = parseInt(data.courseId || data.course, 10);
      if (!isNaN(courseId)) {
        updateData.courseId = courseId;
      }
    }

    const batch = await this.prisma.batch.update({
      where: { id },
      data: updateData,
      include: {
        course: {
          select: { id: true, title: true },
        },
      },
    });

    const formatted = {
      ...batch,
      _id: batch.id.toString(),
      course: batch.course ? { ...batch.course, _id: batch.course.id.toString() } : null,
    };

    return {
      success: true,
      data: formatted,
      message: 'Batch updated successfully',
    };
  }

  async remove(id: number) {
    await this.findOne(id);
    await this.prisma.batch.delete({ where: { id } });
    return {
      success: true,
      message: 'Batch deleted successfully',
    };
  }
}
