import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateLiveClassDto } from './dto/create-live-class.dto';
import { UpdateLiveClassDto } from './dto/update-live-class.dto';

@Injectable()
export class LiveClassesService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    return this.prisma.liveClass.findMany({
      include: { course: { select: { id: true, title: true } } },
      orderBy: { scheduledAt: 'desc' },
    });
  }

  async findAllByCourse(courseId: number) {
    return this.prisma.liveClass.findMany({
      where: { courseId },
      orderBy: { scheduledAt: 'asc' },
    });
  }

  async findOne(id: number) {
    const item = await this.prisma.liveClass.findUnique({
      where: { id },
      include: { course: { select: { id: true, title: true } } },
    });
    if (!item) throw new NotFoundException(`LiveClass with ID ${id} not found`);
    return item;
  }

  async create(courseId: number, dto: CreateLiveClassDto) {
    return this.prisma.liveClass.create({
      data: {
        title: dto.title,
        description: dto.description,
        meetingLink: dto.meetingLink,
        scheduledAt: new Date(dto.scheduledAt),
        durationMins: dto.durationMins ?? 60,
        status: dto.status ?? 'scheduled',
        courseId,
      },
    });
  }

  async update(id: number, dto: UpdateLiveClassDto) {
    await this.findOne(id);
    const { scheduledAt, ...rest } = dto;
    return this.prisma.liveClass.update({
      where: { id },
      data: {
        ...rest,
        ...(scheduledAt ? { scheduledAt: new Date(scheduledAt) } : {}),
      },
    });
  }

  async remove(id: number) {
    await this.findOne(id);
    return this.prisma.liveClass.delete({ where: { id } });
  }
}
