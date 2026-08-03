import { Controller, Get, Post, Put, Delete, Param, Query, Body, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { SeatBookingAdminService } from './seat-booking-admin.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

function getIp(req: Request) {
  return (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '';
}

@Controller('booking')
export class SeatBookingAdminController {
  constructor(private service: SeatBookingAdminService) {}

  // --- Batches (public read, admin write) ---

  @Get('batches')
  async getBatches() {
    const data = await this.service.findBatches();
    return { success: true, data };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Post('batches')
  async createBatch(@Body() body: any) {
    const data = await this.service.createBatch(body);
    return { success: true, data };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Put('batches/:id')
  async updateBatch(@Param('id') id: string, @Body() body: any) {
    const data = await this.service.updateBatch(parseInt(id, 10), body);
    return { success: true, data };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Delete('batches/:id')
  async deleteBatch(@Param('id') id: string) {
    return this.service.deleteBatch(parseInt(id, 10));
  }

  // --- Requests ---

  @UseGuards(JwtAuthGuard)
  @Get('my-request')
  async myRequest(@Req() req: any) {
    const data = await this.service.getMyRequests(req.user);
    return { success: true, data };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Get('all')
  async getAll() {
    const data = await this.service.findAll();
    return { success: true, data };
  }

  @Get('batch/:batchId/seats')
  async getSeats(@Param('batchId') batchId: string, @Query('userId') userId: string, @Req() req: Request) {
    const data = await this.service.getSeatsForBatch(
      parseInt(batchId, 10),
      getIp(req),
      userId ? parseInt(userId, 10) : undefined,
    );
    return { success: true, data };
  }

  @Post('request')
  async createRequest(@Body() body: any, @Req() req: Request) {
    const isAdmin = !!req.headers.authorization;
    const data = await this.service.createRequest(body, getIp(req), isAdmin);
    return { success: true, data };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Put(':id/status')
  async updateStatus(@Param('id') id: string, @Body() body: any) {
    const data = await this.service.updateRequest(parseInt(id, 10), body);
    return { success: true, data };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Delete(':id')
  async deleteRequest(@Param('id') id: string) {
    return this.service.deleteRequest(parseInt(id, 10));
  }
}
