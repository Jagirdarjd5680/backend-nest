import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { Controller, Get, Post, Put, Patch, Delete, Param, Body, UseGuards, Request } from '@nestjs/common';
import { TutorsService } from './tutors.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('tutors')
@UseGuards(JwtAuthGuard)
export class TutorsController {
  constructor(private service: TutorsService) {}

  @Get()
  async findAll() {
    const data = await this.service.findAll();
    return { success: true, data };
  }

  // These "my-*" routes resolve the logged-in tutor from the JWT, so they must stay
  // ahead of the generic ':id' / ':id/detailed' routes below.
  @Get('my-stats')
  async getMyStats(@Request() req: any) {
    return this.service.getMyStats(Number(req.user.id));
  }

  @Get('my-requests')
  async getMyRequests(@Request() req: any) {
    return this.service.getMyRequests(Number(req.user.id));
  }

  @Get('my-media')
  async getMyMedia(@Request() req: any) {
    return this.service.getMyMedia(Number(req.user.id));
  }

  @Put('status')
  async updateMyStatus(@Body() body: { status: string }, @Request() req: any) {
    return this.service.updateMyStatus(Number(req.user.id), body.status);
  }

  @Get(':id/detailed')
  @UseGuards(RolesGuard)
  @Roles('admin', 'teacher')
  async findDetailed(@Param('id') id: string) {
    return this.service.findDetailed(parseInt(id, 10));
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const data = await this.service.findOne(parseInt(id, 10));
    return { success: true, data };
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('admin', 'teacher')
  async create(@Body() data: any) {
    const tutor = await this.service.create(data);
    return { success: true, data: tutor };
  }

  @Put(':id')
  @UseGuards(RolesGuard)
  @Roles('admin', 'teacher')
  async update(@Param('id') id: string, @Body() data: any) {
    const tutor = await this.service.update(parseInt(id, 10), data);
    return { success: true, data: tutor };
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('admin', 'teacher')
  async updatePatch(@Param('id') id: string, @Body() data: any) {
    const tutor = await this.service.update(parseInt(id, 10), data);
    return { success: true, data: tutor };
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('admin', 'teacher')
  async remove(@Param('id') id: string) {
    await this.service.remove(parseInt(id, 10));
    return { success: true, message: 'Tutor deleted successfully' };
  }
}
