import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards, Request } from '@nestjs/common';
import { TimetablesService } from './timetables.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('timetables')
@UseGuards(JwtAuthGuard)
export class TimetablesController {
  constructor(private service: TimetablesService) {}

  @Get()
  async findAll(@Query('batch') batch?: string) {
    const data = await this.service.findAll(batch ? parseInt(batch, 10) : undefined);
    return { success: true, data };
  }

  @Get('my')
  async findMine(@Request() req: any) {
    const data = await this.service.findMine(req.user.id);
    return { success: true, data };
  }

  @Get('course/:courseId')
  async findMineForCourse(@Request() req: any, @Param('courseId') courseId: string) {
    const data = await this.service.findMineForCourse(req.user.id, parseInt(courseId, 10));
    return { success: true, data };
  }

  @Post('bulk')
  async bulkReplace(@Body() body: { batch: string | number; timetable: any[] }) {
    const data = await this.service.bulkReplace(parseInt(String(body.batch), 10), body.timetable || []);
    return { success: true, data };
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
