import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards, Request } from '@nestjs/common';
import { EventBookingsService } from './event-bookings.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('event-bookings')
@UseGuards(JwtAuthGuard)
export class EventBookingsController {
  constructor(private service: EventBookingsService) {}

  /**
   * Real booking flow — always derives the booker from the authenticated JWT
   * (never a client-supplied userId, unlike the generic `create` below).
   */
  @Post('order/:eventId')
  async createOrder(@Param('eventId') eventId: string, @Request() req: any) {
    return this.service.createOrder(req.user.id, parseInt(eventId, 10));
  }

  @Post('verify/:eventId')
  async verifyPayment(
    @Param('eventId') eventId: string,
    @Body() body: { razorpayOrderId: string; razorpayPaymentId: string; razorpaySignature: string },
    @Request() req: any,
  ) {
    return this.service.verifyPayment(req.user.id, parseInt(eventId, 10), body);
  }

  @Get('my-bookings')
  async getMyBookings(@Request() req: any) {
    return this.service.getMyBookings(req.user.id);
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

  @Post()
  @UseGuards(RolesGuard)
  @Roles('admin', 'teacher')
  async create(@Body() data: any) {
    return this.service.create(data);
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
