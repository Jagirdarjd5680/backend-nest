import { Controller, Get, Post, Patch, Delete, Param, Body, Request, UseGuards } from '@nestjs/common';
import { AttendanceService } from './attendance.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('attendance')
@UseGuards(JwtAuthGuard)
export class AttendanceController {
  constructor(private service: AttendanceService) {}

  @Get()
  async findAll() {
    return this.service.findAll();
  }

  @Get('batch/:batchId')
  async findByBatch(@Param('batchId') batchId: string) {
    const numId = parseInt(batchId, 10);
    if (isNaN(numId)) return { success: false, message: 'Invalid Batch ID' };
    return this.service.findByBatch(numId);
  }

  @Get('user/:userId')
  async findByUser(@Param('userId') userId: string) {
    const numId = parseInt(userId, 10);
    if (isNaN(numId)) return { success: false, message: 'Invalid User ID' };
    return this.service.findByUser(numId);
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const numId = parseInt(id, 10);
    if (isNaN(numId)) return { success: false, message: 'Invalid ID' };
    return this.service.findOne(numId);
  }

  @Post('verify')
  async verifyFaceAttendance(@Body() body: { batchId: any; imageBase64: string }) {
    const batchId = parseInt(String(body.batchId), 10);
    return this.service.verifyFaceAttendance(batchId, body.imageBase64);
  }

  @Post('enroll-face')
  async enrollFace(@Request() req: any, @Body() body: { imageBase64: string; userId?: any }) {
    // Admin can enroll on behalf of a student (kiosk/admin-assisted enrollment); otherwise
    // a student enrolls their own face.
    const targetUserId = body.userId && req.user.role === 'admin' ? parseInt(String(body.userId), 10) : req.user.id;
    return this.service.enrollFace(targetUserId, body.imageBase64);
  }

  @Post()
  async create(@Body() data: any) {
    return this.service.create(data);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() data: any) {
    const numId = parseInt(id, 10);
    if (isNaN(numId)) return { success: false, message: 'Invalid ID' };
    return this.service.update(numId, data);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    const numId = parseInt(id, 10);
    if (isNaN(numId)) return { success: false, message: 'Invalid ID' };
    return this.service.remove(numId);
  }
}
