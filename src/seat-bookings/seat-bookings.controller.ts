import { Controller, Get, Post, Patch, Delete, Param, Body, Request, UseGuards } from '@nestjs/common';
import { SeatBookingsService } from './seat-bookings.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@Controller('seat-bookings')
@UseGuards(JwtAuthGuard)
export class SeatBookingsController {
  constructor(private service: SeatBookingsService) {}

  // Must stay ahead of ':id' below, or Nest would match these literal segments as the id param.
  @Get('available-batches')
  async findAvailableBatches() {
    const data = await this.service.findAvailableBatches();
    return { success: true, data };
  }

  @Get('my')
  async findMine(@Request() req: any) {
    const data = await this.service.findMine(req.user.id);
    return { success: true, data };
  }

  @Get()
  @UseGuards(RolesGuard)
  @Roles('admin', 'teacher')
  async findAll() {
    return this.service.findAll();
  }

  @Get(':id')
  @UseGuards(RolesGuard)
  @Roles('admin', 'teacher')
  async findOne(@Param('id') id: string) {
    return this.service.findOne(parseInt(id, 10));
  }

  // Student self-service: request a seat in a batch. userId is always the caller —
  // never trust a client-supplied one.
  @Post('request')
  async requestSeat(@Request() req: any, @Body() body: { batchId: any }) {
    const data = await this.service.requestSeat(req.user.id, parseInt(String(body.batchId), 10));
    return { success: true, data };
  }

  // Admin-initiated, pre-approved booking for a specific student (the "Reserve Seat" flow
  // on the admin Booking Management page).
  @UseGuards(RolesGuard)
  @Roles('admin')
  @Post()
  async create(@Body() body: { studentId: any; batchId: any; seatNumber?: string }) {
    const data = await this.service.createForStudent(
      parseInt(String(body.studentId), 10),
      parseInt(String(body.batchId), 10),
      body.seatNumber,
    );
    return { success: true, data };
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('admin', 'teacher')
  async update(@Param('id') id: string, @Body() data: any) {
    return this.service.update(parseInt(id, 10), data);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('admin', 'teacher')
  async remove(@Param('id') id: string) {
    return this.service.remove(parseInt(id, 10));
  }
}
