import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { WithdrawRequestsService } from './withdraw-requests.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('withdraw-requests')
@UseGuards(JwtAuthGuard)
export class WithdrawRequestsController {
  constructor(private service: WithdrawRequestsService) {}

  @Patch(':id/approve')
  async approve(@Param('id') id: string, @Body() body: { proofScreenshotUrl?: string }) {
    return this.service.approveWithdrawal(parseInt(id, 10), body.proofScreenshotUrl);
  }

  @Patch(':id/reject')
  async reject(@Param('id') id: string, @Body() body: { adminMessage?: string }) {
    return this.service.rejectWithdrawal(parseInt(id, 10), body.adminMessage);
  }

  @Get()
  async findAll() {
    return this.service.findAll();
  }

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
