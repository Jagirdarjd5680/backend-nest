import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

function toBookingDto(r: any) {
  return {
    id: r.id,
    user: { id: r.userId, name: r.userName, email: r.userEmail, phone: r.userPhone },
    batch: r.batch ? { id: r.batch.id, name: r.batch.name } : undefined,
    batchId: r.batchId,
    seatNumber: r.seatNumber,
    zone: r.zone,
    status: r.status,
    createdAt: r.createdAt,
  };
}

@Injectable()
export class SeatBookingAdminService {
  constructor(private prisma: PrismaService) {}

  // --- Batches ---

  async findBatches() {
    return this.prisma.seatBookingBatch.findMany({
      where: { isActive: true, NOT: { name: '' } },
      orderBy: { name: 'asc' },
    });
  }

  async createBatch(data: any) {
    return this.prisma.seatBookingBatch.create({
      data: {
        name: data.name,
        startDate: new Date(data.startDate),
        startTime: data.startTime,
        endTime: data.endTime,
        totalSeats: data.totalSeats ?? 10,
        zones: data.zones ?? undefined,
      },
    });
  }

  async updateBatch(id: number, data: any) {
    const payload: any = { ...data };
    if (payload.startDate) payload.startDate = new Date(payload.startDate);
    delete payload.id;
    delete payload._id;
    delete payload.createdAt;
    delete payload.updatedAt;
    return this.prisma.seatBookingBatch.update({ where: { id }, data: payload });
  }

  async deleteBatch(id: number) {
    await this.prisma.seatBookingBatch.delete({ where: { id } });
    return { success: true, message: 'Batch deleted successfully' };
  }

  // --- Requests ---

  async findAll() {
    const rows = await this.prisma.seatBookingRequest.findMany({
      include: { batch: true },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toBookingDto);
  }

  /** A student may hold at most one active (pending/approved) request per zone —
   *  i.e. one Main Training Area seat AND one Practice Zone seat at the same time. */
  async getMyRequests(user: { id?: number; email?: string; phone?: string }) {
    const conditions: any[] = [];
    if (user.id) conditions.push({ userId: Number(user.id) });
    if (user.email) conditions.push({ userEmail: user.email });
    if (user.phone) conditions.push({ userPhone: user.phone });
    if (conditions.length === 0) return [];

    const rows = await this.prisma.seatBookingRequest.findMany({
      where: { OR: conditions, status: { in: ['pending', 'approved'] } },
      include: { batch: true },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toBookingDto);
  }

  async getSeatsForBatch(batchId: number, ip?: string, userId?: number) {
    const rows = await this.prisma.seatBookingRequest.findMany({
      where: { batchId, status: { in: ['pending', 'approved'] } },
      include: { batch: true },
    });
    return rows.map((r) => ({
      ...toBookingDto(r),
      isMine: r.ipAddress === ip || (!!userId && r.userId === userId),
    }));
  }

  async createRequest(body: any, ipAddress?: string, isAdmin = false) {
    const { user, batchId, seatNumber, zone } = body;
    if (!user?.name) throw new BadRequestException('Invalid user details');

    const conditions: any[] = [];
    if (user.id) conditions.push({ userId: Number(user.id) });
    if (user.email && user.email !== 'notprovided@gog.com') conditions.push({ userEmail: user.email });
    if (user.phone && user.phone !== 'Not Provided') conditions.push({ userPhone: user.phone });
    if (conditions.length === 0) throw new BadRequestException('Invalid user details');

    // Scoped to `zone`, not the whole batch — a student is allowed one active
    // Main Training Area seat AND one Practice Zone seat at the same time.
    const studentExisting = await this.prisma.seatBookingRequest.findFirst({
      where: { OR: conditions, zone, status: { in: ['pending', 'approved'] } },
    });
    if (studentExisting) throw new BadRequestException(`You already have a ${studentExisting.status} request in this zone`);

    if (!isAdmin) {
      const ipCount = await this.prisma.seatBookingRequest.count({
        where: { ipAddress, zone, status: { in: ['pending', 'approved'] } },
      });
      if (ipCount >= 1) throw new BadRequestException('You have already requested a seat in this zone');
    }

    const existingSeat = await this.prisma.seatBookingRequest.findFirst({
      where: { batchId: Number(batchId), seatNumber: Number(seatNumber), status: 'approved' },
    });
    if (existingSeat) throw new BadRequestException('Seat already booked');

    const created = await this.prisma.seatBookingRequest.create({
      data: {
        userId: user.id ? Number(user.id) : undefined,
        userName: user.name,
        userEmail: user.email,
        userPhone: user.phone,
        batchId: Number(batchId),
        seatNumber: Number(seatNumber),
        zone,
        status: 'pending',
        ipAddress,
      },
      include: { batch: true },
    });
    return toBookingDto(created);
  }

  async updateRequest(id: number, data: any) {
    const payload: any = {};
    if (data.status) payload.status = data.status;
    if (data.batchId) payload.batchId = Number(data.batchId);
    if (data.seatNumber !== undefined) payload.seatNumber = Number(data.seatNumber);
    if (data.zone) payload.zone = data.zone;
    if (data.user) {
      if (data.user.name) payload.userName = data.user.name;
      if (data.user.email) payload.userEmail = data.user.email;
      if (data.user.phone) payload.userPhone = data.user.phone;
      if (data.user.id) payload.userId = Number(data.user.id);
    }

    const updated = await this.prisma.seatBookingRequest.update({
      where: { id },
      data: payload,
      include: { batch: true },
    });
    return toBookingDto(updated);
  }

  async deleteRequest(id: number) {
    await this.prisma.seatBookingRequest.delete({ where: { id } });
    return { success: true, message: 'Booking deleted successfully' };
  }
}
