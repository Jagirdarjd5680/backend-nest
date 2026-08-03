import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards, Res, Request } from '@nestjs/common';
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
  async downloadReceipt(@Request() req: any, @Body() body: { userId?: number; courseId?: number }, @Res() res: Response) {
    const targetUserId = body.userId || req.user.id;
    const { filePath, fileName } = await this.service.generateReceiptPdf(targetUserId, body.courseId);
    return res.download(filePath, fileName);
  }

  @Post('send-receipt')
  async sendReceipt(@Request() req: any, @Body() body: { userId?: number; courseId?: number }) {
    const targetUserId = body.userId || req.user.id;
    return this.service.sendReceiptEmail(targetUserId, body.courseId);
  }

  @Get('user/:userId')
  async findByUserId(@Param('userId') userId: string) {
    const records = await this.service.findByUserId(parseInt(userId, 10));
    // Format response payload to match legacy MongoDB properties, avoiding frontend crashes
    const formatted = records.map((r) => ({
      _id: r.id,
      id: r.id,
      totalFee: r.amountPaid,
      discount: 0,
      finalFee: r.amountPaid,
      emiEnabled: false,
      emiCount: 0,
      paidAmount: r.amountPaid,
      remainingAmount: 0,
      payments: [
        {
          amount: r.amountPaid,
          paymentDate: r.paymentDate,
          paymentMethod: 'cash',
          status: 'completed',
          receiptNumber: `REC-${r.id}`,
        },
      ],
      course: {
        _id: 0,
        id: 0,
        title: 'Mock Course',
      },
    }));
    return { success: true, data: formatted };
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

  @Patch(':id')
  async update(@Param('id') id: string, @Body() data: any) {
    return this.service.update(parseInt(id, 10), data);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.service.remove(parseInt(id, 10));
  }
}
