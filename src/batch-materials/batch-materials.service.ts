import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class BatchMaterialsService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    const materials = await this.prisma.batchMaterial.findMany({
      include: { batch: true },
      orderBy: { createdAt: 'desc' },
    });
    return {
      success: true,
      data: materials.map((m) => ({
        ...m,
        _id: m.id.toString(),
        name: m.title,
        url: m.filePath || '',
        parent: m.parentId ? m.parentId.toString() : null,
      })),
    };
  }

  /**
   * The student-facing course Materials tab has no direct enrollment->batch link to
   * query (Enrollment only records courseId, not which batch) — derive it from
   * BookingBatch (the actual batch-assignment table, same source timetables.service.ts
   * findMine() uses) first, and still fold in Attendance so a student who's been
   * attending a batch's classes sees its materials too even without a BookingBatch row.
   * Attendance alone used to be the only signal here, which left materials invisible
   * for any student who hadn't attended a class yet despite already being assigned.
   */
  async getMyMaterialsForCourse(studentId: number, courseId: number) {
    const [bookings, attendances] = await Promise.all([
      this.prisma.bookingBatch.findMany({
        where: { userId: studentId, batch: { courseId } },
        select: { batchId: true },
      }),
      this.prisma.attendance.findMany({
        where: { studentId, batch: { courseId } },
        select: { batchId: true },
        distinct: ['batchId'],
      }),
    ]);
    const batchIds = Array.from(new Set([
      ...bookings.map((b) => b.batchId),
      ...attendances.map((a) => a.batchId),
    ]));
    if (batchIds.length === 0) {
      return { success: true, data: [] };
    }

    const materials = await this.prisma.batchMaterial.findMany({
      where: { batchId: { in: batchIds }, parentId: null },
      orderBy: { createdAt: 'desc' },
    });
    return {
      success: true,
      data: materials.map((m) => ({
        ...m,
        _id: m.id.toString(),
        name: m.title,
        url: m.filePath || '',
      })),
    };
  }

  async findByBatch(batchId: number, parentId: number | null = null) {
    const materials = await this.prisma.batchMaterial.findMany({
      where: {
        batchId,
        parentId: parentId,
      },
      include: { batch: true },
      orderBy: { createdAt: 'desc' },
    });
    const formatted = materials.map((m) => ({
      ...m,
      _id: m.id.toString(),
      name: m.title,
      url: m.filePath || '',
      parent: m.parentId ? m.parentId.toString() : null,
      batch: m.batch ? { ...m.batch, _id: m.batch.id.toString() } : null,
    }));
    return {
      success: true,
      data: formatted,
    };
  }

  async findAllForBatch(batchId: number) {
    const materials = await this.prisma.batchMaterial.findMany({
      where: { batchId },
      include: { batch: true },
      orderBy: { title: 'asc' },
    });
    const formatted = materials.map((m) => ({
      ...m,
      _id: m.id.toString(),
      name: m.title,
      url: m.filePath || '',
      parent: m.parentId ? m.parentId.toString() : null,
    }));
    return {
      success: true,
      data: formatted,
    };
  }

  async findOne(id: number) {
    const item = await this.prisma.batchMaterial.findUnique({
      where: { id },
      include: { batch: true },
    });
    if (!item) throw new NotFoundException(`BatchMaterial with ID ${id} not found`);
    return {
      success: true,
      data: {
        ...item,
        _id: item.id.toString(),
        name: item.title,
        url: item.filePath || '',
        parent: item.parentId ? item.parentId.toString() : null,
      },
    };
  }

  async uploadFile(file: any, body: any) {
    if (!file) {
      throw new BadRequestException('No file provided');
    }

    const batchId = parseInt(body.batch || body.batchId, 10);
    const parentId = body.parent && body.parent !== 'null' && body.parent !== 'undefined' ? parseInt(body.parent, 10) : null;
    const url = `/uploads/${file.filename}`;

    const ext = file.originalname.split('.').pop()?.toLowerCase() || '';
    let type = 'file';
    if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext)) type = 'image';
    else if (['mp4', 'webm', 'mkv', 'avi', 'mov'].includes(ext)) type = 'video';
    else if (['mp3', 'wav', 'aac', 'ogg', 'm4a'].includes(ext)) type = 'audio';
    else if (['pdf'].includes(ext)) type = 'pdf';
    else if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) type = 'zip';
    else if (['js', 'ts', 'jsx', 'tsx', 'html', 'css', 'json', 'py', 'java', 'cpp', 'c', 'cs'].includes(ext)) type = 'code';

    const material = await this.prisma.batchMaterial.create({
      data: {
        title: file.originalname,
        type,
        filePath: url,
        batchId,
        parentId,
      },
      include: { batch: true },
    });

    return {
      success: true,
      data: {
        ...material,
        _id: material.id.toString(),
        name: material.title,
        url: material.filePath || '',
        parent: material.parentId ? material.parentId.toString() : null,
      },
    };
  }

  async addFromMedia(body: any) {
    const batchId = parseInt(body.batch || body.batchId, 10);
    const parentId = body.parent && body.parent !== 'null' && body.parent !== 'undefined' ? parseInt(body.parent, 10) : null;
    const mediaId = String(body.mediaId);

    const media = await this.prisma.media.findUnique({ where: { id: mediaId } });
    if (!media) throw new NotFoundException('Media item not found');

    const material = await this.prisma.batchMaterial.create({
      data: {
        title: media.title || media.name,
        type: 'image',
        filePath: media.fileUrl || media.url,
        batchId,
        parentId,
      },
      include: { batch: true },
    });

    return {
      success: true,
      data: {
        ...material,
        _id: material.id.toString(),
        name: material.title,
        url: material.filePath || '',
        parent: material.parentId ? material.parentId.toString() : null,
      },
    };
  }

  async bulkDelete(ids: any[]) {
    const numIds = (ids || []).map((id) => parseInt(String(id), 10)).filter((id) => !isNaN(id));
    if (numIds.length > 0) {
      await this.prisma.batchMaterial.deleteMany({
        where: { id: { in: numIds } },
      });
    }
    return { success: true, message: `${numIds.length} items deleted successfully` };
  }

  async create(data: any) {
    const batchId = parseInt(data.batch || data.batchId, 10);
    const parentId = data.parent && data.parent !== 'null' && data.parent !== 'undefined'
      ? parseInt(data.parent, 10)
      : (data.parentId ? parseInt(data.parentId, 10) : null);

    const type = data.type || (data.url ? 'link' : 'folder');

    const material = await this.prisma.batchMaterial.create({
      data: {
        title: data.name || data.title || 'Untitled Material',
        type,
        filePath: data.url || data.filePath || '',
        batchId,
        parentId,
      },
      include: { batch: true },
    });

    return {
      success: true,
      data: {
        ...material,
        _id: material.id.toString(),
        name: material.title,
        url: material.filePath || '',
        parent: material.parentId ? material.parentId.toString() : null,
      },
    };
  }

  async update(id: number, data: any) {
    await this.findOne(id);
    const updated = await this.prisma.batchMaterial.update({
      where: { id },
      data: {
        title: data.name || data.title,
        filePath: data.url || data.filePath,
        parentId: data.parent !== undefined ? (data.parent ? parseInt(data.parent, 10) : null) : undefined,
      },
    });
    return {
      success: true,
      data: {
        ...updated,
        _id: updated.id.toString(),
        name: updated.title,
        url: updated.filePath || '',
        parent: updated.parentId ? updated.parentId.toString() : null,
      },
    };
  }

  async remove(id: number) {
    await this.findOne(id);
    await this.prisma.batchMaterial.delete({ where: { id } });
    return { success: true, message: 'Material deleted successfully' };
  }
}
