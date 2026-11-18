import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { Controller, Get, Post, Put, Patch, Delete, Param, Body, Query, UseGuards, Res, Request } from '@nestjs/common';
import { FeeRecordsService } from './fee-records.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Response } from 'express';

@Controller('fee-records')
@UseGuards(JwtAuthGuard)
export class FeeRecordsController {
  constructor(private service: FeeRecordsService) {}

  @Get()
  @UseGuards(RolesGuard)
  @Roles('admin', 'teacher')
  async findAll() {
    return this.service.findAll();
  }

  // ─── Specific routes FIRST (before :id parameter) ──────────────────────────

  @Post('download-receipt')
  async downloadReceipt(@Request() req: any, @Body() body: { userId?: number; courseId?: number; paymentIndex?: number }, @Res() res: Response) {
    const targetUserId = body.userId || req.user.id;
    const { filePath, fileName } = await this.service.generateReceiptPdf(targetUserId, body.courseId, body.paymentIndex);
    return res.download(filePath, fileName);
  }

  @Post('send-receipt')
  async sendReceipt(@Request() req: any, @Body() body: { userId?: number; courseId?: number; paymentIndex?: number }) {
    const targetUserId = body.userId || req.user.id;
    return this.service.sendReceiptEmail(targetUserId, body.courseId, body.paymentIndex);
  }

  @Post('download-registration-letter')
  async downloadRegistrationLetter(@Request() req: any, @Body() body: { userId?: number; courseId?: number }, @Res() res: Response) {
    const targetUserId = body.userId || req.user.id;
    const { filePath, fileName } = await this.service.generateRegistrationLetterPdf(targetUserId, body.courseId);
    return res.download(filePath, fileName);
  }

  @Post('send-registration-letter')
  async sendRegistrationLetter(@Request() req: any, @Body() body: { userId?: number; courseId?: number }) {
    const targetUserId = body.userId || req.user.id;
    return this.service.sendRegistrationLetterEmail(targetUserId, body.courseId);
  }

  /** Fee Records page "Download receipt": the student's latest payment (or `?paymentIndex=`) as a PDF. */
  @Get('receipt/:userId')
  @UseGuards(RolesGuard)
  @Roles('admin', 'teacher')
  async receiptForStudent(
    @Param('userId') userId: string,
    @Query('courseId') courseId: string | undefined,
    @Query('paymentIndex') paymentIndex: string | undefined,
    @Res() res: Response,
  ) {
    const { filePath, fileName } = await this.service.generateReceiptPdf(
      parseInt(userId, 10),
      courseId ? parseInt(courseId, 10) : undefined,
      paymentIndex !== undefined && paymentIndex !== '' ? parseInt(paymentIndex, 10) : undefined,
    );
    return res.download(filePath, fileName);
  }

  @Get('user/:userId')
  @UseGuards(RolesGuard)
  @Roles('admin', 'teacher')
  async findByUserId(@Param('userId') userId: string) {
    const records = await this.service.findByUserId(parseInt(userId, 10));
    return { success: true, data: records };
  }

  // ─── General CRUD ──────────────────────────────────────────────────────────

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

  // PaymentQuickModal.jsx saves an existing fee record with a PUT request; Patch is kept as
  // an alias so any other PATCH-based caller keeps working too.
  @Put(':id')
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
