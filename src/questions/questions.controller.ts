import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { Controller, Get, Post, Put, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { QuestionsService } from './questions.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('questions')
@UseGuards(JwtAuthGuard)
export class QuestionsController {
  constructor(private service: QuestionsService) {}

  @Get('bin/count')
  @UseGuards(RolesGuard)
  @Roles('admin', 'teacher')
  async getBinCount() {
    const count = await this.service.getBinCount();
    return { success: true, count };
  }

  @Get('bin/all')
  @UseGuards(RolesGuard)
  @Roles('admin', 'teacher')
  async getBinAll() {
    return this.service.getBinAll();
  }

  @Put('restore/:id')
  @UseGuards(RolesGuard)
  @Roles('admin', 'teacher')
  async restoreQuestion(@Param('id') id: string) {
    const data = await this.service.restoreQuestion(parseInt(id, 10));
    return { success: true, data };
  }

  @Delete('permanent/:id')
  @UseGuards(RolesGuard)
  @Roles('admin', 'teacher')
  async permanentDelete(@Param('id') id: string) {
    await this.service.permanentDelete(parseInt(id, 10));
    return { success: true };
  }

  @Get()
  @UseGuards(RolesGuard)
  @Roles('admin', 'teacher')
  async findAll() {
    return this.service.findAll();
  }

  @Get(':id')
  @UseGuards(RolesGuard)
  @Roles('admin', 'teacher')
  async findOne(@Param('id') id: string) {
    return this.service.findOne(parseInt(id, 10));
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('admin', 'teacher')
  async create(@Body() data: any) {
    return this.service.create(data);
  }

  @Put(':id')
  @UseGuards(RolesGuard)
  @Roles('admin', 'teacher')
  async update(@Param('id') id: string, @Body() data: any) {
    return this.service.update(parseInt(id, 10), data);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('admin', 'teacher')
  async remove(@Param('id') id: string) {
    return this.service.remove(parseInt(id, 10));
  }
}
