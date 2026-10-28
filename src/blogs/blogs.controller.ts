import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { Controller, Get, Post, Patch, Delete, Param, Body, Query, Request, UseGuards } from '@nestjs/common';
import { BlogsService } from './blogs.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { isStaff } from '../common/access';

@Controller('blogs')
@UseGuards(JwtAuthGuard)
export class BlogsController {
  constructor(private service: BlogsService) {}

  @Get()
  async findAll(
    @Request() req: any,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ) {
    const data = await this.service.findAll({
      search,
      // Students only ever see published posts; staff can filter by any status.
      status: isStaff(req.user) ? status : 'published',
      limit: limit ? parseInt(limit, 10) : undefined,
    });
    return { success: true, data };
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.service.findOne(parseInt(id, 10));
  }

  @Post()
  async create(@Request() req: any, @Body() data: any) {
    return this.service.create(data, req.user?.name || 'Admin');
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
