import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** Only confirmed bookings (free, or paid + verified) count as "enrolled". */
const CONFIRMED = { status: 'confirmed' } as const;

@Injectable()
export class EventsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Events plus how many students are enrolled. The raw `bookings` relation used to be returned
   * to every caller - that leaked every student's ticket code and made `enrolledCount` impossible
   * to show - so only the count goes out here (the admin's list of names is `getEnrolled`).
   */
  private withCount<T extends { id: number; _count?: { bookings: number } }>(event: T) {
    const { _count, ...rest } = event;
    return { ...rest, _id: event.id.toString(), enrolledCount: _count?.bookings ?? 0 };
  }

  async findAll() {
    const events = await this.prisma.event.findMany({
      orderBy: { date: 'asc' },
      include: { _count: { select: { bookings: { where: CONFIRMED } } } },
    });
    return events.map((e) => this.withCount(e));
  }

  async findOne(id: number) {
    const item = await this.prisma.event.findUnique({
      where: { id },
      include: { _count: { select: { bookings: { where: CONFIRMED } } } },
    });
    if (!item) throw new NotFoundException(`Events with ID ${id} not found`);
    return this.withCount(item);
  }

  /** Admin: who has a confirmed ticket for this event (name, contact, ticket code, checked in?). */
  async getEnrolled(id: number) {
    const event = await this.prisma.event.findUnique({ where: { id }, select: { id: true, title: true } });
    if (!event) throw new NotFoundException(`Events with ID ${id} not found`);
    const bookings = await this.prisma.eventBooking.findMany({
      where: { eventId: id, ...CONFIRMED },
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { id: true, name: true, email: true, phone: true, rollNumber: true } } },
    });
    return {
      success: true,
      event,
      count: bookings.length,
      checkedIn: bookings.filter((b) => b.checkedInAt).length,
      data: bookings.map((b) => ({
        _id: b.id.toString(),
        id: b.id,
        student: b.user,
        ticketCode: b.ticketCode,
        amountPaid: b.amountPaid,
        bookedAt: b.createdAt,
        checkedInAt: b.checkedInAt,
      })),
    };
  }

  /** Whitelists the editable columns - the body used to go straight into Prisma. */
  private fields(data: any, creating: boolean) {
    const out: Record<string, any> = {};
    if (data.title !== undefined) out.title = String(data.title).trim();
    if (data.description !== undefined) out.description = String(data.description);
    if (data.date !== undefined && data.date !== '') {
      const d = new Date(data.date);
      if (Number.isNaN(d.getTime())) throw new BadRequestException('Invalid event date');
      out.date = d;
    }
    if (data.price !== undefined && data.price !== '') {
      const price = Number(data.price);
      if (!Number.isFinite(price) || price < 0) throw new BadRequestException('Invalid ticket price');
      out.price = price;
    }
    // '' / null clears the thumbnail, undefined leaves it alone.
    if (data.thumbnail !== undefined) out.thumbnail = data.thumbnail ? String(data.thumbnail) : null;
    if (creating && (!out.title || out.description === undefined || !out.date)) {
      throw new BadRequestException('Title, description and date are required');
    }
    return out;
  }

  async create(data: any) {
    const event = await this.prisma.event.create({ data: this.fields(data, true) as any });
    return { ...event, _id: event.id.toString(), enrolledCount: 0 };
  }

  async update(id: number, data: any) {
    await this.findOne(id);
    const event = await this.prisma.event.update({ where: { id }, data: this.fields(data, false) });
    return { ...event, _id: event.id.toString() };
  }

  async remove(id: number) {
    await this.findOne(id);
    return this.prisma.event.delete({ where: { id } });
  }
}
