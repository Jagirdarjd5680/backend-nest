import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** Columns the client may never set through the builder document. */
const RESERVED = new Set(['id', '_id', 'userId', 'user', 'createdAt', 'updatedAt', 'filePath', 'success']);

/** The builder posts its whole document; it lives in the `data` JSON column. */
function toDocument(body: any) {
  const doc: any = {};
  for (const [k, v] of Object.entries(body || {})) if (!RESERVED.has(k)) doc[k] = v;
  return doc;
}

/** Flatten back to the shape the builder edits: document fields + row ids. */
function toResume(row: any) {
  if (!row) return row;
  const { data, ...rest } = row;
  return { ...(data && typeof data === 'object' ? data : {}), ...rest };
}

@Injectable()
export class ResumesService {
  constructor(private prisma: PrismaService) {}

  /** Every row, or only one user's when `userId` is given. */
  async findAll(userId?: number) {
    const rows = await this.prisma.resume.findMany({
      where: userId != null ? { userId } : undefined,
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { updatedAt: 'desc' },
    });
    return rows.map(toResume);
  }

  async findOne(id: number) {
    const item = await this.prisma.resume.findUnique({
      where: { id },
      include: { user: { select: { id: true, name: true, email: true } } },
    });
    if (!item) throw new NotFoundException(`Resumes with ID ${id} not found`);
    return toResume(item);
  }

  async create(body: any) {
    const row = await this.prisma.resume.create({
      data: {
        userId: Number(body.userId),
        filePath: typeof body.filePath === 'string' ? body.filePath : '',
        data: toDocument(body),
      },
    });
    return toResume(row);
  }

  async update(id: number, body: any) {
    await this.findOne(id);
    const data: any = { data: toDocument(body) };
    if (typeof body?.filePath === 'string') data.filePath = body.filePath;
    return toResume(await this.prisma.resume.update({ where: { id }, data }));
  }

  async remove(id: number) {
    await this.findOne(id);
    return this.prisma.resume.delete({ where: { id } });
  }
}
