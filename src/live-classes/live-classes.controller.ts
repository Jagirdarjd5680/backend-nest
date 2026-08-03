import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { LiveClassesService } from './live-classes.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { ModulePermissionsGuard } from '../auth/module-permissions.guard';
import { RequireModulePermission } from '../auth/module-permissions.decorator';
import { CreateLiveClassDto } from './dto/create-live-class.dto';
import { UpdateLiveClassDto } from './dto/update-live-class.dto';

@Controller('live-classes')
@UseGuards(JwtAuthGuard)
export class LiveClassesController {
  constructor(private service: LiveClassesService) {}

  @Get()
  async findAll() {
    const data = await this.service.findAll();
    return { success: true, data };
  }

  // Must stay ahead of ':id' below, or Nest would match "course" as the :id param.
  @Get('course/:courseId')
  async findAllByCourse(@Param('courseId') courseId: string) {
    const data = await this.service.findAllByCourse(parseInt(courseId, 10));
    return { success: true, data };
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const data = await this.service.findOne(parseInt(id, 10));
    return { success: true, data };
  }

  @UseGuards(RolesGuard, ModulePermissionsGuard)
  @Roles('admin', 'teacher')
  @RequireModulePermission('courses', 'add')
  @Post('course/:courseId')
  async create(@Param('courseId') courseId: string, @Body() dto: CreateLiveClassDto) {
    const data = await this.service.create(parseInt(courseId, 10), dto);
    return { success: true, data };
  }

  @UseGuards(RolesGuard, ModulePermissionsGuard)
  @Roles('admin', 'teacher')
  @RequireModulePermission('courses', 'edit')
  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateLiveClassDto) {
    const data = await this.service.update(parseInt(id, 10), dto);
    return { success: true, data };
  }

  @UseGuards(RolesGuard, ModulePermissionsGuard)
  @Roles('admin', 'teacher')
  @RequireModulePermission('courses', 'delete')
  @Delete(':id')
  async remove(@Param('id') id: string) {
    const data = await this.service.remove(parseInt(id, 10));
    return { success: true, data };
  }
}
