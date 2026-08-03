import { Controller, Get, Post, Put, Patch, Param, Body, UseGuards } from '@nestjs/common';
import { LeavesService } from './leaves.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('leaves')
@UseGuards(JwtAuthGuard)
export class LeavesController {
  constructor(private leavesService: LeavesService) {}

  @Get()
  async findAll() {
    return this.leavesService.findAll();
  }

  @Post()
  async create(@Body() data: any) {
    return this.leavesService.create(data);
  }

  // The admin web page calls PUT, not PATCH — stacking both decorators on one handler
  // doesn't register two routes in Nest (the later decorator just overwrites the
  // earlier one's route metadata), so this needs two real handler methods. Previously
  // there was only @Patch here while `AdminLeaveRequests.jsx` calls `api.put(...)`,
  // so approve/reject 404'd outright.
  @Put(':id/status')
  async updateStatusPut(@Param('id') id: string, @Body() body: { status: string; adminMessage?: string }) {
    return this.leavesService.updateStatus(parseInt(id, 10), body.status, body.adminMessage);
  }

  @Patch(':id/status')
  async updateStatusPatch(@Param('id') id: string, @Body() body: { status: string; adminMessage?: string }) {
    return this.leavesService.updateStatus(parseInt(id, 10), body.status, body.adminMessage);
  }
}
