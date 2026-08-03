import { Controller, Get, Post, Put, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
import { ExamsService } from './exams.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { ModulePermissionsGuard } from '../auth/module-permissions.guard';
import { RequireModulePermission } from '../auth/module-permissions.decorator';
import { CreateExamDto, SubmitExamDto, SubmitExamResultDto, CreateQuestionDto } from './dto/create-exam.dto';

@Controller('exams')
@UseGuards(JwtAuthGuard)
export class ExamsController {
  constructor(private service: ExamsService) {}

  // Shared with students (their own exams/results) — the module-permission check
  // above only ever restricts `teacher` accounts, so this stays safe for everyone else.
  @Get()
  async findAll(@Request() req: any, @Query('course') course?: string) {
    const courseId = course ? parseInt(course, 10) : undefined;
    return this.service.findAllExams(req.user?.id, req.user?.role, courseId);
  }

  @UseGuards(RolesGuard, ModulePermissionsGuard)
  @Roles('admin', 'teacher')
  @RequireModulePermission('exams', 'view')
  @Get('results/all')
  async getResults() {
    return this.service.findAllResults();
  }

  @UseGuards(RolesGuard, ModulePermissionsGuard)
  @Roles('admin', 'teacher')
  @RequireModulePermission('exams', 'view')
  @Get('questions/all')
  async getQuestions() {
    return this.service.findAllQuestions();
  }

  // Must stay ahead of ':id' below, or Nest would match "progress" as the :id param.
  @Get(':id/progress')
  async getProgress(@Param('id') id: string, @Request() req: any) {
    const data = await this.service.getProgress(parseInt(id, 10), req.user.id);
    return { success: true, data };
  }

  @Put(':id/progress')
  async saveProgress(@Param('id') id: string, @Request() req: any, @Body() data: any) {
    const result = await this.service.saveProgress(parseInt(id, 10), req.user.id, data);
    return { success: true, data: result };
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @Request() req: any) {
    return this.service.findOneExam(parseInt(id, 10), req.user?.id, req.user?.role);
  }

  @UseGuards(RolesGuard, ModulePermissionsGuard)
  @Roles('admin', 'teacher')
  @RequireModulePermission('exams', 'add')
  @Post()
  async create(@Request() req: any, @Body() data: CreateExamDto) {
    return this.service.createExam(req.user.id, data);
  }

  @UseGuards(RolesGuard, ModulePermissionsGuard)
  @Roles('admin', 'teacher')
  @RequireModulePermission('exams', 'edit')
  @Put(':id')
  async update(@Param('id') id: string, @Request() req: any, @Body() data: any) {
    return this.service.updateExam(parseInt(id, 10), req.user.id, req.user.role, data);
  }

  @Post('submit-exam')
  async submitExam(@Request() req: any, @Body() data: SubmitExamDto) {
    return this.service.submitExam(req.user.id, data);
  }

  @Post('submit')
  async submitResult(@Body() data: SubmitExamResultDto) {
    return this.service.submitResult(data);
  }

  @UseGuards(RolesGuard, ModulePermissionsGuard)
  @Roles('admin', 'teacher')
  @RequireModulePermission('exams', 'add')
  @Post('question')
  async createQuestion(@Body() data: CreateQuestionDto) {
    return this.service.createQuestion(data);
  }
}
