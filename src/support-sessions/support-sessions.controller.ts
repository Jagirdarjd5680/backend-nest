import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards, Request } from '@nestjs/common';
import { SupportSessionsService } from './support-sessions.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('support-sessions')
@UseGuards(JwtAuthGuard)
export class SupportSessionsController {
  constructor(private service: SupportSessionsService) {}

  @Get('my-history')
  async getMyHistory(@Request() req: any) {
    return this.service.getMyHistory(req.user.id);
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
