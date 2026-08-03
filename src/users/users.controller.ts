import { Controller, Get, Post, Put, Delete, Query, UseGuards, Param, Body, Request, ForbiddenException } from '@nestjs/common';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { ModulePermissionsGuard } from '../auth/module-permissions.guard';
import { RequireModulePermission } from '../auth/module-permissions.decorator';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Get('bin/count')
  @UseGuards(RolesGuard)
  @Roles('admin')
  async getBinCount() {
    const count = await this.usersService.getBinCount();
    return { success: true, count };
  }

  @Get('bin/all')
  @UseGuards(RolesGuard)
  @Roles('admin')
  async getBinAll() {
    const data = await this.usersService.getBinAll();
    return { success: true, data };
  }

  @Put('restore/:id')
  @UseGuards(RolesGuard)
  @Roles('admin')
  async restoreUser(@Param('id') id: string) {
    const user = await this.usersService.restoreUser(parseInt(id, 10));
    return { success: true, data: user, message: 'User restored successfully' };
  }

  @Delete('permanent/:id')
  @UseGuards(RolesGuard)
  @Roles('admin')
  async permanentDelete(@Param('id') id: string) {
    const user = await this.usersService.permanentDelete(parseInt(id, 10));
    return { success: true, data: user, message: 'User permanently deleted' };
  }

  @Post('bulk/archive')
  @UseGuards(RolesGuard)
  @Roles('admin')
  async bulkArchive(@Body() body: { ids: (string | number)[] }) {
    const ids = (body.ids || []).map((id) => parseInt(String(id), 10));
    const result = await this.usersService.bulkArchive(ids);
    return { success: true, data: result, message: `${result.count} users moved to recycle bin` };
  }

  @Get()
  @UseGuards(RolesGuard, ModulePermissionsGuard)
  @Roles('admin', 'teacher')
  @RequireModulePermission('students', 'view')
  async findAll(
    @Request() req: any,
    @Query('role') role: string,
    @Query('search') search: string,
    @Query('page') page: string,
    @Query('limit') limit: string,
    @Query('isDeleted') isDeleted: string,
  ) {
    // A teacher's "students" permission only ever covers student records — never
    // the staff/admin list — regardless of what role filter they pass in.
    const effectiveRole = req.user?.role === 'teacher' ? 'student' : role;
    return this.usersService.findAll({
      role: effectiveRole,
      search,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      isDeleted,
    });
  }

  @Put('student-profile')
  async updateOwnStudentProfile(@Request() req: any, @Body() body: any) {
    const user = await this.usersService.updateStudentProfile(req.user.id, body.profileData);
    return { success: true, data: user, message: 'Profile updated' };
  }

  @Post('request-registration')
  async requestRegistration() {
    return { success: true, message: 'Registration request sent' };
  }

  @Get(':id/submissions')
  @UseGuards(RolesGuard)
  @Roles('admin')
  async getSubmissions(@Param('id') id: string) {
    return { success: true, data: [] };
  }

  @Put(':id/student-profile-admin')
  @UseGuards(RolesGuard)
  @Roles('admin')
  async updateStudentProfileAdmin(@Param('id') id: string, @Body() body: any) {
    const user = await this.usersService.updateStudentProfile(parseInt(id, 10), body.profileData);
    return { success: true, data: user, message: 'Profile updated by admin' };
  }

  @Put(':id/biometric-face')
  async updateBiometricFace(@Param('id') id: string, @Body() body: any) {
    const user = await this.usersService.updateBiometricFace(parseInt(id, 10), body);
    return { success: true, data: user, message: 'Biometric updated' };
  }


  @Post(':id/sync-subscriptions')
  @UseGuards(RolesGuard)
  @Roles('admin')
  async syncSubscriptions(@Param('id') id: string) {
    return { success: true, message: 'Subscriptions synced' };
  }

  @Post(':id/resend-registration-letter')
  @UseGuards(RolesGuard)
  @Roles('admin')
  async resendRegistrationLetter(@Param('id') id: string) {
    return { success: true, message: 'Registration letter sent' };
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const userDetails = await this.usersService.findByIdDetails(parseInt(id, 10));
    return { success: true, data: userDetails };
  }

  @Post()
  @UseGuards(RolesGuard, ModulePermissionsGuard)
  @Roles('admin', 'teacher')
  @RequireModulePermission('students', 'add')
  async create(@Request() req: any, @Body() body: CreateUserDto) {
    // A teacher's "students" permission must never let them create another
    // teacher/admin account — only ever plain students.
    if (req.user?.role === 'teacher' && body.role && body.role !== 'student') {
      throw new ForbiddenException('You can only create student accounts');
    }
    const user = await this.usersService.create(req.user?.role === 'teacher' ? { ...body, role: 'student' } : body);
    return { success: true, data: user };
  }

  @Put(':id')
  @UseGuards(RolesGuard, ModulePermissionsGuard)
  @Roles('admin', 'teacher')
  @RequireModulePermission('students', 'edit')
  async update(@Param('id') id: string, @Request() req: any, @Body() body: UpdateUserDto) {
    const targetId = parseInt(id, 10);
    if (req.user?.role === 'teacher') {
      const target = await this.usersService.findById(targetId);
      if (!target || target.role !== 'student') {
        throw new ForbiddenException('You can only edit student accounts');
      }
      if ((body as any).role && (body as any).role !== 'student') {
        throw new ForbiddenException('You cannot change a student\'s role');
      }
    }
    const user = await this.usersService.update(targetId, body);
    return { success: true, data: user };
  }

  @Delete(':id')
  @UseGuards(RolesGuard, ModulePermissionsGuard)
  @Roles('admin', 'teacher')
  @RequireModulePermission('students', 'delete')
  async remove(@Param('id') id: string, @Request() req: any) {
    const targetId = parseInt(id, 10);
    if (req.user?.role === 'teacher') {
      const target = await this.usersService.findById(targetId);
      if (!target || target.role !== 'student') {
        throw new ForbiddenException('You can only delete student accounts');
      }
    }
    const user = await this.usersService.remove(targetId);
    return { success: true, data: user };
  }

  // ─── Biometric Verification ────────────────────────────────────────────
  @Post(':id/biometric/register')
  @UseGuards(RolesGuard)
  @Roles('admin')
  async registerBiometric(@Param('id') id: string, @Body() body: { faceImageUrl: string }) {
    return this.usersService.registerBiometric(parseInt(id, 10), body.faceImageUrl);
  }

  @Post('biometric/verify')
  async verifyBiometric(@Body() body: { userId: number; faceImageUrl: string }) {
    return this.usersService.verifyBiometric(body.userId, body.faceImageUrl);
  }

  // ─── Registration Approval ─────────────────────────────────────────────
  @Get('registration/pending')
  @UseGuards(RolesGuard)
  @Roles('admin')
  async getPendingRegistrations() {
    return this.usersService.getPendingRegistrations();
  }

  @Put(':id/registration/approve')
  @UseGuards(RolesGuard)
  @Roles('admin')
  async approveRegistration(@Param('id') id: string) {
    return this.usersService.approveRegistration(parseInt(id, 10));
  }

  @Put(':id/registration/reject')
  @UseGuards(RolesGuard)
  @Roles('admin')
  async rejectRegistration(@Param('id') id: string, @Body() body: { reason?: string }) {
    return this.usersService.rejectRegistration(parseInt(id, 10), body.reason);
  }
}
