import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards } from '@nestjs/common';
import { WithdrawalsService } from './withdrawals.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('withdrawals')
@UseGuards(JwtAuthGuard)
export class WithdrawalsController {
  constructor(private service: WithdrawalsService) {}

  @Get('admin/all')
  @UseGuards(RolesGuard)
  @Roles('admin')
  async findAllAdmin(@Query('status') status?: string) {
    const data = await this.service.findAll(status);
    return { success: true, data };
  }

  @Get('all')
  @UseGuards(RolesGuard)
  @Roles('admin')
  async findAllAlias(@Query('status') status?: string) {
    const data = await this.service.findAll(status);
    return { success: true, data };
  }

  @Patch('admin/:id')
  @UseGuards(RolesGuard)
  @Roles('admin')
  async updateAdminWithdrawal(@Param('id') id: string, @Body() body: any) {
    const data = await this.service.updateAdminWithdrawal(parseInt(id, 10), body);
    return { success: true, data };
  }

  @Get('my')
  @UseGuards(RolesGuard)
  @Roles('admin')
  async findMyWithdrawals() {
    const data = await this.service.findAll();
    return { success: true, data };
  }

  @Get()
  @UseGuards(RolesGuard)
  @Roles('admin')
  async findAll() {
    const data = await this.service.findAll();
    return { success: true, data };
  }

  @Get(':id')
  @UseGuards(RolesGuard)
  @Roles('admin')
  async findOne(@Param('id') id: string) {
    const numId = parseInt(id, 10);
    if (isNaN(numId)) return { success: false, message: 'Invalid ID' };
    return this.service.findOne(numId);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('admin')
  async create(@Body() data: any) {
    const dataObj = await this.service.create(data);
    return { success: true, data: dataObj };
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('admin')
  async update(@Param('id') id: string, @Body() data: any) {
    const dataObj = await this.service.update(parseInt(id, 10), data);
    return { success: true, data: dataObj };
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('admin')
  async remove(@Param('id') id: string) {
    await this.service.remove(parseInt(id, 10));
    return { success: true, message: 'Deleted successfully' };
  }
}
