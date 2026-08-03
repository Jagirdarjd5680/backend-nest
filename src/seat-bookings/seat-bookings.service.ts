import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SeatBookingsService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    return this.prisma.seatBooking.findMany({
      include: {
          user: true,
          batch: true
      }
    });
  }

  async findOne(id: number) {
    const item = await this.prisma.seatBooking.findUnique({
      where: { id },
      include: {
          user: true,
          batch: true
      }
    });
    if (!item) throw new NotFoundException(`SeatBookings with ID ${id} not found`);
    return item;
  }

  async findMine(userId: number) {
    return this.prisma.seatBooking.findMany({
      where: { userId },
      include: { batch: { include: { course: { select: { id: true, title: true } } } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Batch.maxStudents minus its already-approved SeatBookings — no separate
   * "seat inventory" model exists (or is needed): a batch's capacity IS the seat count,
   * and pending/rejected requests don't consume a seat, only approved ones do.
   */
  async findAvailableBatches() {
    const batches = await this.prisma.batch.findMany({
      where: { isActive: true },
      include: {
        course: { select: { id: true, title: true } },
        seatBookings: { where: { status: 'approved' }, select: { id: true } },
      },
      orderBy: { startDate: 'asc' },
    });
    return batches.map((b) => ({
      id: b.id,
      name: b.name,
      startDate: b.startDate,
      timing: b.timing,
      course: b.course,
      maxStudents: b.maxStudents,
      approvedCount: b.seatBookings.length,
      availableSeats: Math.max(0, b.maxStudents - b.seatBookings.length),
    }));
  }

  /** userId always comes from the authenticated caller — never trust a client-supplied one. */
  async requestSeat(userId: number, batchId: number) {
    const batch = await this.prisma.batch.findUnique({
      where: { id: batchId },
      include: { seatBookings: { where: { status: 'approved' }, select: { id: true } } },
    });
    if (!batch) throw new NotFoundException('Batch not found');

    const existing = await this.prisma.seatBooking.findFirst({
      where: { userId, batchId, status: { in: ['pending', 'approved'] } },
    });
    if (existing) {
      throw new BadRequestException(`You already have a ${existing.status} request for this batch.`);
    }

    if (batch.seatBookings.length >= batch.maxStudents) {
      throw new BadRequestException('No seats available in this batch.');
    }

    return this.prisma.seatBooking.create({
      data: { userId, batchId, status: 'pending' },
    });
  }

  /** Admin-initiated booking (pre-approved) for a specific student — the "Reserve Seat" flow. */
  async createForStudent(studentId: number, batchId: number, seatNumber?: string) {
    const batch = await this.prisma.batch.findUnique({
      where: { id: batchId },
      include: { seatBookings: { where: { status: 'approved' }, select: { id: true } } },
    });
    if (!batch) throw new NotFoundException('Batch not found');
    if (batch.seatBookings.length >= batch.maxStudents) {
      throw new BadRequestException('No seats available in this batch.');
    }

    return this.prisma.seatBooking.create({
      data: { userId: studentId, batchId, status: 'approved', seatNumber: seatNumber || null },
    });
  }

  async update(id: number, data: any) {
    await this.findOne(id);
    // Only `status`/`seatNumber` are ever meant to change post-creation (admin
    // approve/reject/assign-seat) — batch/user reassignment isn't a real workflow here.
    return this.prisma.seatBooking.update({
      where: { id },
      data: { status: data.status, seatNumber: data.seatNumber },
    });
  }

  async remove(id: number) {
    await this.findOne(id);
    return this.prisma.seatBooking.delete({ where: { id } });
  }
}
