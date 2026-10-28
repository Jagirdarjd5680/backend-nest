import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { Controller, Get, Post, Put, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { PassedStudentsService } from './passed-students.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('passed-students')
@UseGuards(JwtAuthGuard)
export class PassedStudentsController {
  constructor(private service: PassedStudentsService) {}

  @Get('admin')
  @UseGuards(RolesGuard)
  @Roles('admin', 'teacher')
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
  @UseGuards(RolesGuard)
  @Roles('admin', 'teacher')
  async create(@Body() data: any) {
    return { success: true, data: await this.service.create(data) };
  }

  @Put(':id')
  @UseGuards(RolesGuard)
  @Roles('admin', 'teacher')
  async update(@Param('id') id: string, @Body() data: any) {
    return { success: true, data: await this.service.update(parseInt(id, 10), data) };
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('admin', 'teacher')
  async remove(@Param('id') id: string) {
    await this.service.remove(parseInt(id, 10));
    return { success: true, message: 'Entry deleted successfully' };
  }
}
