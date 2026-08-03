import { Controller, Get, Post, Put, Patch, Delete, Param, Body, UseGuards, Request, Headers } from '@nestjs/common';
import { CoursesService } from './courses.service';
import { ReviewsService } from '../reviews/reviews.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { ModulePermissionsGuard } from '../auth/module-permissions.guard';
import { RequireModulePermission } from '../auth/module-permissions.decorator';
import { CreateCourseDto } from './dto/create-course.dto';
import { UpdateCourseDto } from './dto/update-course.dto';
import { normalizePlatform } from '../common/platform';

@Controller('courses')
export class CoursesController {
  constructor(
    private coursesService: CoursesService,
    private reviewsService: ReviewsService,
  ) {}

  // Public course catalog — intentionally unguarded, browsable while logged out.
  @Get()
  async findAll() {
    const courses = await this.coursesService.findAll();
    return { success: true, data: courses };
  }

  // Must stay ahead of ':id' below, or Nest/Express would match "my" as the :id param.
  @UseGuards(JwtAuthGuard)
  @Get('my/enrolled')
  async findMyEnrollments(@Request() req: any) {
    const data = await this.coursesService.findMyEnrollments(Number(req.user.id || req.user._id));
    return { success: true, data };
  }

  // Admin/teacher edit & "view details" screens (CourseWizard, CourseViewModal) hit this
  // instead of the public findOne below — that one enforces Course.platformAccess (web/app/
  // both), a student-facing restriction that must never block staff from managing a course
  // that happens to be restricted to a platform. Must stay ahead of ':id' or Nest would match
  // "manage" as the :id param.
  @UseGuards(JwtAuthGuard, RolesGuard, ModulePermissionsGuard)
  @Roles('admin', 'teacher')
  @RequireModulePermission('courses', 'view')
  @Get('manage/:id')
  async findOneForManage(@Param('id') id: string) {
    const course = await this.coursesService.findOneForManage(parseInt(id, 10));
    return { success: true, data: course };
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @Headers('x-platform') platformHeader?: string) {
    const course = await this.coursesService.findOne(parseInt(id, 10), normalizePlatform(platformHeader));
    return { success: true, data: course };
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id/reviews')
  async getReviews(@Param('id') id: string, @Request() req: any) {
    const data = await this.reviewsService.findByCourse(parseInt(id, 10), Number(req.user.id || req.user._id));
    return { success: true, data };
  }

  // Enrolled students only (enforced in the service) — same account editing their existing
  // review, whether it was first submitted from web or the app, rather than creating a duplicate.
  @UseGuards(JwtAuthGuard)
  @Post(':id/reviews')
  async submitReview(@Param('id') id: string, @Body() body: { rating: number; comment: string }, @Request() req: any) {
    const userId = Number(req.user.id || req.user._id);
    const data = await this.reviewsService.upsertMyReview(userId, parseInt(id, 10), Number(body.rating), body.comment || '');
    return { success: true, data };
  }

  @UseGuards(JwtAuthGuard, RolesGuard, ModulePermissionsGuard)
  @Roles('admin', 'teacher')
  @RequireModulePermission('courses', 'add')
  @Post()
  async create(@Body() data: CreateCourseDto) {
    const course = await this.coursesService.create(data);
    return { success: true, data: course };
  }

  @UseGuards(JwtAuthGuard, RolesGuard, ModulePermissionsGuard)
  @Roles('admin', 'teacher')
  @RequireModulePermission('courses', 'edit')
  @Patch(':id')
  async updatePatch(@Param('id') id: string, @Body() data: UpdateCourseDto) {
    const course = await this.coursesService.update(parseInt(id, 10), data);
    return { success: true, data: course };
  }

  @UseGuards(JwtAuthGuard, RolesGuard, ModulePermissionsGuard)
  @Roles('admin', 'teacher')
  @RequireModulePermission('courses', 'edit')
  @Put(':id')
  async updatePut(@Param('id') id: string, @Body() data: UpdateCourseDto) {
    const course = await this.coursesService.update(parseInt(id, 10), data);
    return { success: true, data: course };
  }

  @UseGuards(JwtAuthGuard, RolesGuard, ModulePermissionsGuard)
  @Roles('admin', 'teacher')
  @RequireModulePermission('courses', 'edit')
  @Put(':id/publish')
  async publish(@Param('id') id: string, @Body('isPublished') isPublished: boolean) {
    const course = await this.coursesService.publish(parseInt(id, 10), isPublished);
    return { success: true, data: course };
  }

  // Student self-service — not a management action, left open to any authenticated user.
  @UseGuards(JwtAuthGuard)
  @Post(':id/enroll')
  async enrollFree(@Request() req: any, @Param('id') id: string, @Headers('x-platform') platformHeader?: string) {
    const enrollment = await this.coursesService.enrollFree(req.user.id, parseInt(id, 10), normalizePlatform(platformHeader));
    return { success: true, data: enrollment };
  }

  @UseGuards(JwtAuthGuard, RolesGuard, ModulePermissionsGuard)
  @Roles('admin', 'teacher')
  @RequireModulePermission('courses', 'add')
  @Post(':id/duplicate')
  async duplicate(@Param('id') id: string) {
    const course = await this.coursesService.duplicate(parseInt(id, 10));
    return { success: true, data: course };
  }

  @UseGuards(JwtAuthGuard, RolesGuard, ModulePermissionsGuard)
  @Roles('admin', 'teacher')
  @RequireModulePermission('courses', 'delete')
  @Delete(':id')
  async remove(@Param('id') id: string) {
    const course = await this.coursesService.remove(parseInt(id, 10));
    return { success: true, data: course };
  }
}
