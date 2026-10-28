import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { WithdrawRequestsService } from './withdraw-requests.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('withdraw-requests')
@UseGuards(JwtAuthGuard)
export class WithdrawRequestsController {
  constructor(private service: WithdrawRequestsService) {}

  @Patch(':id/approve')
  @UseGuards(RolesGuard)
  @Roles('admin')
  async approve(@Param('id') id: string, @Body() body: { proofScreenshotUrl?: string }) {
    return this.service.approveWithdrawal(parseInt(id, 10), body.proofScreenshotUrl);
  }

  @Patch(':id/reject')
  @UseGuards(RolesGuard)
  @Roles('admin')
  async reject(@Param('id') id: string, @Body() body: { adminMessage?: string }) {
    return this.service.rejectWithdrawal(parseInt(id, 10), body.adminMessage);
  }

  @Get()
  @UseGuards(RolesGuard)
  @Roles('admin')
  async findAll() {
    return this.service.findAll();
  }

  @Get(':id')
  @UseGuards(RolesGuard)
  @Roles('admin')
  async findOne(@Param('id') id: string) {
    return this.service.findOne(parseInt(id, 10));
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('admin')
  async create(@Body() data: any) {
    return this.service.create(data);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('admin')
  async update(@Param('id') id: string, @Body() data: any) {
    return this.service.update(parseInt(id, 10), data);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('admin')
  async remove(@Param('id') id: string) {
    return this.service.remove(parseInt(id, 10));
  }
}
