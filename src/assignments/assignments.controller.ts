import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  UseGuards,
  Request,
} from '@nestjs/common';
import { AssignmentsService } from './assignments.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateAssignmentDto, UpdateAssignmentDto } from './dto/create-assignment.dto';
import { SubmitAssignmentDto } from './dto/submit-assignment.dto';
import { GradeSubmissionDto } from './dto/grade-submission.dto';

@Controller('assignments')
export class AssignmentsController {
  constructor(private service: AssignmentsService) {}

  // ─── Specific GET routes FIRST (Public/Flexible read access) ─────────────

  @Get('all-submissions')
  async getAllSubmissions(@Query('limit') limit?: string) {
    const lim = limit ? parseInt(limit, 10) : 10;
    return this.service.findAllSubmissions(isNaN(lim) ? 10 : lim);
  }

  @Get('batch/:batchId/submissions')
  async getBatchSubmissions(@Param('batchId') batchId: string) {
    const numId = parseInt(batchId, 10);
    if (isNaN(numId)) {
      return {
        success: true,
        data: {
          batchId,
          batchName: 'Batch Cohort',
          assignments: [],
          students: [],
        },
      };
    }
    return this.service.findBatchSubmissions(numId);
  }

  @Get('unlocks/all')
  async getUnlocks() {
    return this.service.findAllUnlocks();
  }

  @Get('materials/all')
  async getMaterials() {
    return this.service.findAllMaterials();
  }

  // ─── General CRUD ──────────────────────────────────────────────────────────

  @Get()
  async findAll(@Query('course') course?: string) {
    const courseId = course ? parseInt(course, 10) : undefined;
    return this.service.findAllAssignments(courseId);
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const numId = parseInt(id, 10);
    if (isNaN(numId)) return { success: false, message: 'Invalid ID' };
    return this.service.findOneAssignment(numId);
  }

  // ─── Protected Mutations ───────────────────────────────────────────────────

  @UseGuards(JwtAuthGuard)
  @Post()
  async create(@Body() data: CreateAssignmentDto) {
    return this.service.createAssignment(data);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/submit')
  async submitAssignment(
    @Param('id') id: string,
    @Request() req: any,
    @Body() data: SubmitAssignmentDto,
  ) {
    const numId = parseInt(id, 10);
    return this.service.submitAssignment(numId, req.user.id, data);
  }

  @UseGuards(JwtAuthGuard)
  @Put('submissions/:submissionId/grade')
  async gradeSubmission(
    @Param('submissionId') submissionId: string,
    @Body() data: GradeSubmissionDto,
  ) {
    const numId = parseInt(submissionId, 10);
    return this.service.gradeSubmission(numId, data);
  }

  @UseGuards(JwtAuthGuard)
  @Put(':id/grade')
  async gradeAssignmentLegacy(@Param('id') id: string, @Body() data: GradeSubmissionDto) {
    const numId = parseInt(id, 10);
    return this.service.gradeSubmission(numId, data);
  }

  @UseGuards(JwtAuthGuard)
  @Put(':id')
  async updatePut(@Param('id') id: string, @Body() data: UpdateAssignmentDto) {
    const numId = parseInt(id, 10);
    if (isNaN(numId)) return { success: false, message: 'Invalid ID' };
    return this.service.updateAssignment(numId, data);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  async updatePatch(@Param('id') id: string, @Body() data: UpdateAssignmentDto) {
    const numId = parseInt(id, 10);
    if (isNaN(numId)) return { success: false, message: 'Invalid ID' };
    return this.service.updateAssignment(numId, data);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  async remove(@Param('id') id: string) {
    const numId = parseInt(id, 10);
    if (isNaN(numId)) return { success: false, message: 'Invalid ID' };
    return this.service.removeAssignment(numId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('unlock')
  async unlock(@Body() data: any) {
    return this.service.unlockAssignment(data);
  }

  @UseGuards(JwtAuthGuard)
  @Post('materials')
  async createMaterial(@Body() data: any) {
    return this.service.createMaterial(data);
  }
}
