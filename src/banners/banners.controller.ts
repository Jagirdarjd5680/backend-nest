import { Controller, Get, Post, Put, Delete, Param, Body, UseGuards, Query, Request, HttpCode, HttpStatus } from '@nestjs/common';
import { BannersService } from './banners.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CreateBannerDto } from './dto/create-banner.dto';
import { UpdateBannerDto } from './dto/update-banner.dto';

@Controller('banners')
export class BannersController {
  constructor(private service: BannersService) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  async findAll(
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const result = await this.service.findAll({
      status,
      page: page ? parseInt(page) : undefined,
      limit: limit ? parseInt(limit) : undefined,
    });
    return {
      success: true,
      total: result.total,
      data: result.banners,
    };
  }

  @Get('public')
  async findPublic() {
    const banners = await this.service.findPublic();
    return {
      success: true,
      data: banners,
    };
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  async findOne(@Param('id') id: string) {
    const banner = await this.service.findOne(parseInt(id, 10));
    return {
      success: true,
      data: banner,
    };
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() createDto: CreateBannerDto, @Request() req: any) {
    const data: any = {
      ...createDto,
      imageUrl: createDto.imageUrl || createDto.image || '',
      createdById: req.user?.id,
    };
    delete data.image; // remove the alias for DB write

    const banner = await this.service.create(data);
    return {
      success: true,
      data: banner,
    };
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async update(@Param('id') id: string, @Body() updateDto: UpdateBannerDto) {
    const data: any = { ...updateDto };
    if (updateDto.image || updateDto.imageUrl) {
      data.imageUrl = updateDto.imageUrl || updateDto.image;
    }
    delete data.image; // remove the alias for DB write

    const banner = await this.service.update(parseInt(id, 10), data);
    return {
      success: true,
      data: banner,
    };
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async remove(@Param('id') id: string) {
    await this.service.remove(parseInt(id, 10));
    return {
      success: true,
      message: 'Banner deleted',
    };
  }
}
