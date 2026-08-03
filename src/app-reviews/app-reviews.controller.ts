import { Controller, Get, Post, Put, Delete, Param, Body, UseGuards, HttpCode, HttpStatus, Query } from '@nestjs/common';
import { AppReviewsService } from './app-reviews.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CreateAppReviewDto } from './dto/create-app-review.dto';
import { UpdateAppReviewDto } from './dto/update-app-review.dto';

@Controller('app-reviews')
export class AppReviewsController {
  constructor(private service: AppReviewsService) {}

  @Get()
  async findAll(@Query('status') status?: string) {
    const reviews = await this.service.findAll({ status });
    return {
      success: true,
      data: reviews,
    };
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const review = await this.service.findOne(parseInt(id, 10));
    return {
      success: true,
      data: review,
    };
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() createDto: CreateAppReviewDto) {
    const review = await this.service.create(createDto);
    return {
      success: true,
      data: review,
    };
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async update(@Param('id') id: string, @Body() updateDto: UpdateAppReviewDto) {
    const review = await this.service.update(parseInt(id, 10), updateDto);
    return {
      success: true,
      data: review,
    };
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async remove(@Param('id') id: string) {
    await this.service.remove(parseInt(id, 10));
    return {
      success: true,
      message: 'Review removed',
    };
  }
}
