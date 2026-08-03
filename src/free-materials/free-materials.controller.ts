import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { FreeMaterialsService } from './free-materials.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('free-materials')
@UseGuards(JwtAuthGuard)
export class FreeMaterialsController {
  constructor(private service: FreeMaterialsService) {}

  @Get()
  async findAll() {
    return this.service.findAll();
  }

  @Get('admin')
  async findAllForAdmin() {
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
