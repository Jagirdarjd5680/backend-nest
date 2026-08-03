import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards } from '@nestjs/common';
import { WithdrawalsService } from './withdrawals.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('withdrawals')
@UseGuards(JwtAuthGuard)
export class WithdrawalsController {
  constructor(private service: WithdrawalsService) {}

  @Get('admin/all')
  async findAllAdmin(@Query('status') status?: string) {
    const data = await this.service.findAll(status);
    return { success: true, data };
  }

  @Get('all')
  async findAllAlias(@Query('status') status?: string) {
    const data = await this.service.findAll(status);
    return { success: true, data };
  }

  @Patch('admin/:id')
  async updateAdminWithdrawal(@Param('id') id: string, @Body() body: any) {
    const data = await this.service.updateAdminWithdrawal(parseInt(id, 10), body);
    return { success: true, data };
  }

  @Get('my')
  async findMyWithdrawals() {
    const data = await this.service.findAll();
    return { success: true, data };
  }

  @Get()
  async findAll() {
    const data = await this.service.findAll();
    return { success: true, data };
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const numId = parseInt(id, 10);
    if (isNaN(numId)) return { success: false, message: 'Invalid ID' };
    return this.service.findOne(numId);
  }

  @Post()
  async create(@Body() data: any) {
    const dataObj = await this.service.create(data);
    return { success: true, data: dataObj };
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() data: any) {
    const dataObj = await this.service.update(parseInt(id, 10), data);
    return { success: true, data: dataObj };
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.service.remove(parseInt(id, 10));
    return { success: true, message: 'Deleted successfully' };
  }
}
