import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { Controller, Get, Post, Patch, Delete, Param, Body, Query, Request, UseGuards, Logger, BadRequestException } from '@nestjs/common';
import { assertSelfOrStaff } from '../common/access';
import { AttendanceService } from './attendance.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('attendance')
@UseGuards(JwtAuthGuard)
export class AttendanceController {
  private readonly logger = new Logger(AttendanceController.name);

  constructor(private service: AttendanceService) {}

  @Get()
  @UseGuards(RolesGuard)
  @Roles('admin', 'teacher')
  async findAll() {
    return this.service.findAll();
  }

  @Get('batch/:batchId')
  @UseGuards(RolesGuard)
  @Roles('admin', 'teacher')
  async findByBatch(@Param('batchId') batchId: string, @Query('date') date?: string) {
    const numId = parseInt(batchId, 10);
    if (isNaN(numId)) return { success: false, message: 'Invalid Batch ID' };
    return this.service.findByBatch(numId, date === 'today');
  }

  @Post('mark')
  @UseGuards(RolesGuard)
  @Roles('admin', 'teacher')
  async markManual(@Body() body: { batchId: any; studentId: any; status?: string }) {
    const batchId = parseInt(String(body.batchId), 10);
    const studentId = parseInt(String(body.studentId), 10);
    if (isNaN(batchId) || isNaN(studentId)) throw new BadRequestException('batchId and studentId are required');
    return this.service.markManual(batchId, studentId, body.status === 'absent' ? 'absent' : 'present');
  }

  @Get('user/:userId')
  async findByUser(@Param('userId') userId: string, @Request() req: any) {
    const numId = parseInt(userId, 10);
    if (isNaN(numId)) return { success: false, message: 'Invalid User ID' };
    assertSelfOrStaff(req.user, numId);
    return this.service.findByUser(numId);
  }

  @Get(':id')
  @UseGuards(RolesGuard)
  @Roles('admin', 'teacher')
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
    // a student enrolls their own face. Role check is case-insensitive because caller role
    // strings ("admin"/"Admin"/"ADMIN") were previously compared with a strict === 'admin',
    // which silently fell through to req.user.id (the admin's own account) whenever the role
    // string didn't match exactly — enrollment "succeeded" but saved the face to the wrong user.
    const isAdmin = String(req.user?.role || '').toLowerCase() === 'admin';
    const targetUserId = body.userId && isAdmin ? parseInt(String(body.userId), 10) : req.user.id;
    this.logger.debug(
      `enroll-face: caller=${req.user?.id} role=${req.user?.role} isAdmin=${isAdmin} bodyUserId=${body.userId} -> targetUserId=${targetUserId} imageLen=${body.imageBase64?.length || 0}`,
    );
    return this.service.enrollFace(targetUserId, body.imageBase64);
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
    const numId = parseInt(id, 10);
    if (isNaN(numId)) return { success: false, message: 'Invalid ID' };
    return this.service.update(numId, data);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('admin', 'teacher')
  async remove(@Param('id') id: string) {
    const numId = parseInt(id, 10);
    if (isNaN(numId)) return { success: false, message: 'Invalid ID' };
    return this.service.remove(numId);
  }
}
