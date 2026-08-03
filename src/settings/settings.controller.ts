import { Controller, Get, Post, Put, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@Controller('settings')
export class SettingsController {
  constructor(private service: SettingsService) {}

  @Get('public')
  async getPublic() {
    return this.service.getPublicSettings();
  }

  @Get('public/storage')
  async getPublicStorage() {
    return this.service.testStorageConnection();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Post('test-ai')
  async testAi(@Body() body: { provider: string; apiKey?: string }) {
    return this.service.testAiConnectivity(body.provider, body.apiKey);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Post('test-storage')
  async testStorage(@Body() body: { provider?: string }) {
    return this.service.testStorageConnection(body.provider);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Get()
  async getAll() {
    return this.service.getAllSettings();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Put()
  async updateBulk(@Body() data: Record<string, any>) {
    const updated = await this.service.updateBulk(data);
    return { success: true, data: updated };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Put(':key')
  async upsert(@Param('key') key: string, @Body('value') value: any) {
    const result = await this.service.upsertSetting(key, value);
    return { success: true, data: result };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Post()
  async create(@Body() data: any) {
    return this.service.create(data);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.service.remove(parseInt(id, 10));
  }
}
