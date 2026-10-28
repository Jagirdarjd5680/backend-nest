import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { PlacementsService } from './placements.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('placements')
@UseGuards(JwtAuthGuard)
export class PlacementsController {
  constructor(private service: PlacementsService) {}

  @Get()
  async findAll() {
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
