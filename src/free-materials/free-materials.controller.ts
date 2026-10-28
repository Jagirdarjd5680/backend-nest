import { Controller, Get, Post, Put, Patch, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { FreeMaterialsService } from './free-materials.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@Controller('free-materials')
@UseGuards(JwtAuthGuard)
export class FreeMaterialsController {
  constructor(private service: FreeMaterialsService) {}

  @Get()
  async findAll() {
    return this.service.findAll();
  }

  @Get('admin')
  @UseGuards(RolesGuard)
  @Roles('admin', 'teacher')
  async findAllForAdmin() {
    return this.service.findAll();
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.service.findOne(parseInt(id, 10));
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('admin', 'teacher')
  async create(@Body() data: any) {
    return this.service.create(data);
  }

  // The admin form (frontend/src/components/FreeMaterial/FreeMaterialFormModal.jsx)
  // calls `api.put(...)` on update, so `@Put` has to exist here too — with only
  // `@Patch` defined, every edit 404'd against this route.
  @Put(':id')
  @UseGuards(RolesGuard)
  @Roles('admin', 'teacher')
  async updatePut(@Param('id') id: string, @Body() data: any) {
    return this.service.update(parseInt(id, 10), data);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('admin', 'teacher')
  async updatePatch(@Param('id') id: string, @Body() data: any) {
    return this.service.update(parseInt(id, 10), data);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('admin', 'teacher')
  async remove(@Param('id') id: string) {
    return this.service.remove(parseInt(id, 10));
  }
}
