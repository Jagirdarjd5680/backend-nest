import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards, Request } from '@nestjs/common';
import { assertOwnsRow } from '../common/access';
import { ExamResultsService } from './exam-results.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('exam-results')
@UseGuards(JwtAuthGuard)
export class ExamResultsController {
  constructor(private service: ExamResultsService) {}

  @Get('summary')
  @UseGuards(RolesGuard)
  @Roles('admin', 'teacher')
  async getSummary() {
    return { success: true, data: await this.service.getSummary() };
  }

  @Get('exam/:examId')
  @UseGuards(RolesGuard)
  @Roles('admin', 'teacher')
  async findByExam(@Param('examId') examId: string) {
    return { success: true, data: await this.service.findByExam(parseInt(examId, 10)) };
  }

  @Get('details/:id')
  async findDetails(@Param('id') id: string, @Request() req: any) {
    const data = await this.service.findDetails(parseInt(id, 10));
    return { success: true, data: assertOwnsRow(req.user, data, (r: any) => r.studentId ?? r.student?.id) };
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

  @Patch(':id')
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
