import { Controller, Get, Post, Put, Patch, Delete, Param, Body, UseGuards } from '@nestjs/common';
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

  @Get(':id/detailed')
  async findDetailed(@Param('id') id: string) {
    return this.service.findDetailed(parseInt(id, 10));
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const data = await this.service.findOne(parseInt(id, 10));
    return { success: true, data };
  }

  @Post()
  async create(@Body() data: any) {
    const tutor = await this.service.create(data);
    return { success: true, data: tutor };
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() data: any) {
    const tutor = await this.service.update(parseInt(id, 10), data);
    return { success: true, data: tutor };
  }

  @Patch(':id')
  async updatePatch(@Param('id') id: string, @Body() data: any) {
    const tutor = await this.service.update(parseInt(id, 10), data);
    return { success: true, data: tutor };
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.service.remove(parseInt(id, 10));
    return { success: true, message: 'Tutor deleted successfully' };
  }
}
