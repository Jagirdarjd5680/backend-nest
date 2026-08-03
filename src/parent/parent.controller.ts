import { Controller, Get, Post, Param, Body, UseGuards, Request } from '@nestjs/common';
import { ParentService } from './parent.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('parent')
@UseGuards(JwtAuthGuard)
export class ParentController {
  constructor(private service: ParentService) {}

  @Get('children')
  async getChildren(@Request() req: any) {
    return this.service.getChildren(req.user.id);
  }

  @Post('link-child')
  async linkChild(@Request() req: any, @Body() body: { childId: number }) {
    return this.service.linkChild(req.user.id, body.childId);
  }

  @Get('child/:id/attendance')
  async getChildAttendance(@Request() req: any, @Param('id') id: string) {
    return this.service.getChildAttendance(req.user.id, parseInt(id, 10));
  }

  @Get('child/:id/fees')
  async getChildFees(@Request() req: any, @Param('id') id: string) {
    return this.service.getChildFees(req.user.id, parseInt(id, 10));
  }

  @Get('child/:id/progress')
  async getChildProgress(@Request() req: any, @Param('id') id: string) {
    return this.service.getChildProgress(req.user.id, parseInt(id, 10));
  }
}
