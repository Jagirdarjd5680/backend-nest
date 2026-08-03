import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { ExamResultsService } from './exam-results.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('exam-results')
@UseGuards(JwtAuthGuard)
export class ExamResultsController {
  constructor(private service: ExamResultsService) {}

  @Get('summary')
  async getSummary() {
    return { success: true, data: await this.service.getSummary() };
  }

  @Get('exam/:examId')
  async findByExam(@Param('examId') examId: string) {
    return { success: true, data: await this.service.findByExam(parseInt(examId, 10)) };
  }

  @Get('details/:id')
  async findDetails(@Param('id') id: string) {
    return { success: true, data: await this.service.findDetails(parseInt(id, 10)) };
  }

  @Get()
  async findAll() {
    return this.service.findAll();
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
