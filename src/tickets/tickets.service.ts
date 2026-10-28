import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * The `tickets` table only has subject/message/status. The web admin sends `description`
 * (+ `priority`) and the app sends `message`; anything else used to reach Prisma and 500.
 */
function pickTicketFields(data: any, requireBody: boolean) {
  const out: any = {};
  if (data?.subject !== undefined) out.subject = String(data.subject).trim();
  const body = data?.message ?? data?.description;
  if (body !== undefined) out.message = String(body);
  if (data?.status !== undefined) out.status = String(data.status);
  if (data?.userId !== undefined) out.userId = Number(data.userId);
  if (requireBody && (!out.subject || !out.message)) {
    throw new BadRequestException('subject and message are required');
  }
  return out;
}

/** The web page reads `description`; the app reads `message` — expose both. */
const withAliases = (t: any) => (t ? { ...t, description: t.message } : t);

@Injectable()
export class TicketsService {
  constructor(private prisma: PrismaService) {}

  /** Every row, or only one user's when `userId` is given. */
  async findAll(userId?: number) {
    const rows = await this.prisma.ticket.findMany({
      where: userId != null ? { userId } : undefined,
      include: {
          user: { select: { id: true, name: true, email: true, avatar: true } }
      },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(withAliases);
  }

  async findOne(id: number) {
    const item = await this.prisma.ticket.findUnique({
      where: { id },
      include: {
          user: { select: { id: true, name: true, email: true, avatar: true } }
      }
    });
    if (!item) throw new NotFoundException(`Tickets with ID ${id} not found`);
    return withAliases(item);
  }

  async create(data: any) {
    const fields = pickTicketFields(data, true);
    if (!fields.userId) throw new BadRequestException('userId is required');
    return withAliases(await this.prisma.ticket.create({ data: fields }));
  }

  async update(id: number, data: any) {
    await this.findOne(id);
    return withAliases(await this.prisma.ticket.update({ where: { id }, data: pickTicketFields(data, false) }));
  }

  /** No replies table — a reply is appended to the ticket body (same as the app does). */
  async reply(id: number, text: string, author: string) {
    const ticket = await this.findOne(id);
    if (!text?.trim()) throw new BadRequestException('text is required');
    const stamp = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
    const message = `${ticket.message}\n\n— ${author} (${stamp}):\n${text.trim()}`;
    return withAliases(await this.prisma.ticket.update({ where: { id }, data: { message } }));
  }

  async remove(id: number) {
    await this.findOne(id);
    return this.prisma.ticket.delete({ where: { id } });
  }
}
