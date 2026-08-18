import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards, Request } from '@nestjs/common';
import { CourseProgressService } from './course-progress.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('course-progress')
@UseGuards(JwtAuthGuard)
export class CourseProgressController {
  constructor(private service: CourseProgressService) {}

  @Post('complete-lecture')
  async completeLecture(
    @Request() req: any,
    @Body() body: { courseId: number; lectureId: string },
  ) {
    return this.service.completeLecture(req.user.id, body.courseId, body.lectureId);
  }

  @Post('lecture-watch')
  async recordLectureWatch(
    @Request() req: any,
    @Body() body: { courseId: number; lectureId: string; deltaSeconds: number; durationSeconds?: number },
  ) {
    const data = await this.service.recordLectureWatch(
      req.user.id,
      body.courseId,
      body.lectureId,
      body.deltaSeconds,
      body.durationSeconds,
    );
    return { success: true, data };
  }

  @Get('course/:courseId/lectures')
  async lectureProgressForCourse(@Request() req: any, @Param('courseId') courseId: string) {
    const data = await this.service.getLectureProgressForCourse(req.user.id, parseInt(courseId, 10));
    return { success: true, data };
  }

  @Get('continue-learning')
  async continueLearning(@Request() req: any) {
    const data = await this.service.getContinueLearning(req.user.id);
    return { success: true, data };
  }

  @Get('course/:courseId')
  async courseSummary(@Request() req: any, @Param('courseId') courseId: string) {
    const data = await this.service.getCourseProgressSummary(req.user.id, parseInt(courseId, 10));
    return { success: true, data };
  }

  /**
   * Self-serve fallback for students who crossed the 95% threshold before this auto-issue
   * wiring existed (or via some path that doesn't call maybeAutoIssueCertificate) — lets the
   * Certificate tab claim it on open instead of waiting for another completeLecture/submit call.
   */
  @Post('course/:courseId/claim-certificate')
  async claimCertificate(@Request() req: any, @Param('courseId') courseId: string) {
    const numCourseId = parseInt(courseId, 10);
    const issued = await this.service.maybeAutoIssueCertificate(req.user.id, numCourseId);
    return { success: true, issued };
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
