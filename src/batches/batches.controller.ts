import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { BatchesService } from './batches.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('batches')
export class BatchesController {
  constructor(private batchesService: BatchesService) {}

  @Get()
  async findAll() {
    return this.batchesService.findAll();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'teacher')
  @Get(':id/students')
  async getStudents(@Param('id') id: string) {
    const numId = parseInt(id, 10);
    if (isNaN(numId)) return { success: false, message: 'Invalid ID' };
    return this.batchesService.getStudents(numId);
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const numId = parseInt(id, 10);
    if (isNaN(numId)) return { success: false, message: 'Invalid ID' };
    return this.batchesService.findOne(numId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Post()
  @Roles('admin', 'teacher')
  async create(@Body() data: any) {
    return this.batchesService.create(data);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Put(':id')
  @Roles('admin', 'teacher')
  async updatePut(@Param('id') id: string, @Body() data: any) {
    const numId = parseInt(id, 10);
    if (isNaN(numId)) return { success: false, message: 'Invalid ID' };
    return this.batchesService.update(numId, data);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Patch(':id')
  @Roles('admin', 'teacher')
  async updatePatch(@Param('id') id: string, @Body() data: any) {
    const numId = parseInt(id, 10);
    if (isNaN(numId)) return { success: false, message: 'Invalid ID' };
    return this.batchesService.update(numId, data);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Delete(':id')
  @Roles('admin', 'teacher')
  async remove(@Param('id') id: string) {
    const numId = parseInt(id, 10);
    if (isNaN(numId)) return { success: false, message: 'Invalid ID' };
    return this.batchesService.remove(numId);
  }
}
