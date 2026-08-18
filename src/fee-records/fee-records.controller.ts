import { Controller, Get, Post, Put, Patch, Delete, Param, Body, UseGuards, Res, Request } from '@nestjs/common';
import { FeeRecordsService } from './fee-records.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Response } from 'express';

@Controller('fee-records')
@UseGuards(JwtAuthGuard)
export class FeeRecordsController {
  constructor(private service: FeeRecordsService) {}

  @Get()
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

  @Get('user/:userId')
  async findByUserId(@Param('userId') userId: string) {
    const records = await this.service.findByUserId(parseInt(userId, 10));
    return { success: true, data: records };
  }

  // ─── General CRUD ──────────────────────────────────────────────────────────

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.service.findOne(parseInt(id, 10));
  }

  @Post()
  async create(@Body() data: any) {
    return this.service.create(data);
  }

  // PaymentQuickModal.jsx saves an existing fee record with a PUT request; Patch is kept as
  // an alias so any other PATCH-based caller keeps working too.
  @Put(':id')
  @Patch(':id')
  async update(@Param('id') id: string, @Body() data: any) {
    return this.service.update(parseInt(id, 10), data);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.service.remove(parseInt(id, 10));
  }
}
