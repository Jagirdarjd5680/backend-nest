import { Body, Controller, Get, NotFoundException, Post, Put, Req, Res, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { R2Service } from './r2.service';

const PASS_HEADERS = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified'];

@Controller('r2')
export class R2Controller {
  constructor(private readonly service: R2Service) {}

  /**
   * GET /api/r2/file/<key> — streams the object from the private bucket (no presigned
   * redirect, so the bucket needs no CORS rules). Range requests pass through, so videos can seek.
   * Public on purpose, same as the existing /uploads static route: <img>/<video> tags and
   * the mobile app's image loader can't attach a JWT.
   *
   * Works whether or not R2 is currently enabled, so files uploaded while it was on
   * keep loading after it's switched off.
   */
  @SkipThrottle()
  @Get('file/*')
  async file(@Req() req: Request, @Res() res: Response) {
    const key = decodeURIComponent(String((req.params as any)[0] || ''));
    if (!key || key.includes('..')) throw new NotFoundException();
    const upstream = await this.service.openObject(key, {
      range: req.headers.range,
      ifNoneMatch: req.headers['if-none-match'] as string | undefined,
    });
    if (!upstream) throw new NotFoundException('File not found');

    // Some S3 servers answer Range with 200 + Content-Range; video players need 206 to seek.
    const partial = upstream.statusCode === 200 && !!upstream.headers['content-range'];
    res.status(partial ? 206 : upstream.statusCode || 200);
    for (const h of PASS_HEADERS) {
      const v = upstream.headers[h];
      if (v !== undefined) res.setHeader(h, v);
    }
    // Object keys carry a timestamp and are never overwritten, so the content is immutable.
    res.setHeader('Cache-Control', 'private, max-age=86400');
    req.on('close', () => upstream.destroy());
    upstream.pipe(res);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Get('config')
  async getConfig() {
    return { success: true, data: await this.service.getMaskedConfig() };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Put('config')
  async saveConfig(@Body() body: any) {
    return { success: true, data: await this.service.saveConfig(body || {}) };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Post('test')
  async test(@Body() body: any) {
    return this.service.testConnection(body || {});
  }
}
