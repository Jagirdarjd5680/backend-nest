import { Controller, Get, Post, Put, Delete, Param, Query, Body, UseGuards, BadRequestException, Res } from '@nestjs/common';
import type { Response } from 'express';
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
  async testAi(@Body() body: { provider: string; apiKey?: string; model?: string; config?: { apiKey?: string; model?: string } }) {
    return this.service.testAiConnectivity(body.provider, body.apiKey ?? body.config?.apiKey, body.model ?? body.config?.model);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Post('chat-ai')
  async chatAi(@Body() body: { provider: string; message: string; apiKey?: string; model?: string; config?: { apiKey?: string; model?: string } }) {
    try {
      return await this.service.chatWithAi(body.provider, body.apiKey ?? body.config?.apiKey, body.message, body.model ?? body.config?.model);
    } catch (err) {
      throw new BadRequestException(err.message);
    }
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Post('test-storage')
  async testStorage(@Body() body: { provider?: string }) {
    return this.service.testStorageConnection(body.provider);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Get('pdf-demo/:type')
  async pdfDemo(@Param('type') type: string, @Query('download') download: string, @Res() res: Response) {
    if (type !== 'receipt' && type !== 'registration' && type !== 'certificate') {
      throw new BadRequestException('type must be "receipt", "registration", or "certificate"');
    }
    const buffer = await this.service.generatePdfDemo(type);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', download === 'true' ? `attachment; filename="demo-${type}.pdf"` : 'inline');
    res.send(buffer);
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
