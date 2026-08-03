import { Controller, Get, Post, Put, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { PassedStudentsService } from './passed-students.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('passed-students')
@UseGuards(JwtAuthGuard)
export class PassedStudentsController {
  constructor(private service: PassedStudentsService) {}

  @Get('admin')
  async findAllAdmin() {
    return { success: true, data: await this.service.findAllAdmin() };
  }

  @Get()
  async findAll() {
    return { success: true, data: await this.service.findAll() };
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.service.findOne(parseInt(id, 10));
  }

  @Post()
  async create(@Body() data: any) {
    return { success: true, data: await this.service.create(data) };
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() data: any) {
    return { success: true, data: await this.service.update(parseInt(id, 10), data) };
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.service.remove(parseInt(id, 10));
    return { success: true, message: 'Entry deleted successfully' };
  }
}
