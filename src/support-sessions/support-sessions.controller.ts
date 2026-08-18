import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards, Request } from '@nestjs/common';
import { SupportSessionsService } from './support-sessions.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@Controller('support-sessions')
@UseGuards(JwtAuthGuard)
export class SupportSessionsController {
  constructor(private service: SupportSessionsService) {}

  @Get('my-history')
  async getMyHistory(@Request() req: any) {
    return this.service.getMyHistory(req.user.id);
  }

  // Must stay ahead of the generic ':id' route below.
  @Get('pending-earnings')
  @UseGuards(RolesGuard)
  @Roles('admin')
  async getPendingEarnings() {
    return this.service.getPendingEarnings();
  }

  @Post(':id/approve-earning')
  @UseGuards(RolesGuard)
  @Roles('admin')
  async approveEarning(@Param('id') id: string) {
    return this.service.approveEarning(parseInt(id, 10));
  }

  @Post('request')
  async requestSession(
    @Request() req: any,
    @Body() body: { tutorId: number; category?: string },
  ) {
    return this.service.requestSession(req.user.id, body.tutorId, body.category);
  }

  @Patch(':id/status')
  async updateStatus(
    @Param('id') id: string,
    @Body() body: { status: string; meetUrl?: string },
  ) {
    return this.service.updateSessionStatus(parseInt(id, 10), body.status, body.meetUrl);
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
