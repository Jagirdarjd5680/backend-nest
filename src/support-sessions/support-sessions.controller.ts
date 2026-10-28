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

  // Also must stay ahead of ':id' — used by the admin "Tutor Chats" monitoring page
  // (frontend/src/pages/Tutors/SupportChatCenter.jsx), which previously 404'd here
  // because this route didn't exist at all.
  @Get('admin/all')
  @UseGuards(RolesGuard)
  @Roles('admin')
  async findAllForAdmin() {
    return this.service.findAllForAdmin();
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
    @Request() req: any,
  ) {
    await this.service.assertParticipant(parseInt(id, 10), req.user);
    return this.service.updateSessionStatus(parseInt(id, 10), body.status, body.meetUrl);
  }

  @Get()
  @UseGuards(RolesGuard)
  @Roles('admin', 'teacher')
  async findAll() {
    return this.service.findAll();
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @Request() req: any) {
    await this.service.assertParticipant(parseInt(id, 10), req.user);
    const data = await this.service.findOne(parseInt(id, 10));
    return { success: true, data };
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('admin', 'teacher')
  async create(@Body() data: any) {
    return this.service.create(data);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() data: any, @Request() req: any) {
    await this.service.assertParticipant(parseInt(id, 10), req.user);
    return this.service.update(parseInt(id, 10), data);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('admin', 'teacher')
  async remove(@Param('id') id: string) {
    return this.service.remove(parseInt(id, 10));
  }
}
