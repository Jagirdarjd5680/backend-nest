import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { Controller, Get, Post, Put, Patch, Param, Body, UseGuards, Request } from '@nestjs/common';
import { isStaff } from '../common/access';
import { LeavesService } from './leaves.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('leaves')
@UseGuards(JwtAuthGuard)
export class LeavesController {
  constructor(private leavesService: LeavesService) {}

  /** Staff see every request; students only their own (the mobile app filters this list too). */
  @Get()
  async findAll(@Request() req: any) {
    return isStaff(req.user) ? this.leavesService.findAll() : this.leavesService.findByUser(req.user.id);
  }

  @Get('my')
  async findMine(@Request() req: any) {
    return this.leavesService.findByUser(req.user.id);
  }

  @Post()
  async create(@Body() data: any, @Request() req: any) {
    // Students can only apply for themselves; staff may file on a student's behalf.
    return this.leavesService.create(isStaff(req.user) ? data : { ...data, userId: req.user.id });
  }

  // The admin web page calls PUT, not PATCH — stacking both decorators on one handler
  // doesn't register two routes in Nest (the later decorator just overwrites the
  // earlier one's route metadata), so this needs two real handler methods. Previously
  // there was only @Patch here while `AdminLeaveRequests.jsx` calls `api.put(...)`,
  // so approve/reject 404'd outright.
  @Put(':id/status')
  @UseGuards(RolesGuard)
  @Roles('admin', 'teacher')
  async updateStatusPut(@Param('id') id: string, @Body() body: { status: string; adminMessage?: string }) {
    return this.leavesService.updateStatus(parseInt(id, 10), body.status, body.adminMessage);
  }

  @Patch(':id/status')
  @UseGuards(RolesGuard)
  @Roles('admin', 'teacher')
  async updateStatusPatch(@Param('id') id: string, @Body() body: { status: string; adminMessage?: string }) {
    return this.leavesService.updateStatus(parseInt(id, 10), body.status, body.adminMessage);
  }
}
