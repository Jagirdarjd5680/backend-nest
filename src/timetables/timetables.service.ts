import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class TimetablesService {
  constructor(private prisma: PrismaService) {}

  async findAll(batchId?: number) {
    const rows = await this.prisma.timetable.findMany({
      where: batchId ? { batchId } : undefined,
      include: {
          batch: true
      }
    });
    return rows.map((r) => ({ 
      ...r, 
      subject: r.topic,
      teacher: r.teacherId ? String(r.teacherId) : null,
      course: r.courseId ? String(r.courseId) : null
    }));
  }

  async bulkReplace(batchId: number, slots: any[]) {
    await this.prisma.timetable.deleteMany({ where: { batchId } });
    if (!slots.length) return [];

    await this.prisma.timetable.createMany({
      data: slots.map((s) => ({
        day: s.day,
        topic: s.subject || s.topic || '',
        startTime: s.startTime || null,
        endTime: s.endTime || null,
        teacherId: s.teacher ? parseInt(s.teacher, 10) : null,
        courseId: s.course ? parseInt(s.course, 10) : null,
        batchId,
      })),
    });

    return this.findAll(batchId);
  }

  async findMine(userId: number) {
    const bookings = await this.prisma.bookingBatch.findMany({
      where: { userId },
      select: { batchId: true },
    });
    const attendances = await this.prisma.attendance.findMany({
      where: { studentId: userId },
      select: { batchId: true },
      distinct: ['batchId'],
    });
    
    const batchIds = Array.from(new Set([
      ...bookings.map((b) => b.batchId),
      ...attendances.map((a) => a.batchId)
    ]));
    
    if (batchIds.length === 0) return [];

    const rows = await this.prisma.timetable.findMany({
      where: { batchId: { in: batchIds } },
      include: {
          batch: true
      }
    });
    return rows.map((r) => ({ 
      ...r, 
      subject: r.topic,
      teacher: r.teacherId ? String(r.teacherId) : null,
      course: r.courseId ? String(r.courseId) : null
    }));
  }

  async findOne(id: number) {
    const item = await this.prisma.timetable.findUnique({
      where: { id },
      include: {
          batch: true
      }
    });
    if (!item) throw new NotFoundException(`Timetables with ID ${id} not found`);
    return item;
  }

  async create(data: any) {
    return this.prisma.timetable.create({ data });
  }

  async update(id: number, data: any) {
    await this.findOne(id);
    return this.prisma.timetable.update({ where: { id }, data });
  }

  async remove(id: number) {
    await this.findOne(id);
    return this.prisma.timetable.delete({ where: { id } });
  }
}
