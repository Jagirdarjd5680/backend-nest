import { Controller, Get, Query, Request, Res, UseGuards, BadRequestException, NotFoundException } from '@nestjs/common';
import type { Response } from 'express';
import { existsSync } from 'fs';
import { join, normalize, resolve, extname } from 'path';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { MediaAccessService } from './media-access.service';

const UPLOADS_ROOT = resolve(join(__dirname, '..', '..', 'uploads'));

const CONTENT_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.pdf': 'application/pdf',
  '.mp4': 'video/mp4',
  '.mp3': 'audio/mpeg',
};

/** Resolves `relativePath` against UPLOADS_ROOT and throws if it escapes that directory (path traversal). */
function resolveSafePath(relativePath: string): string {
  const cleaned = normalize(relativePath).replace(/^([./\\]+)/, '');
  const full = resolve(UPLOADS_ROOT, cleaned);
  if (!full.startsWith(UPLOADS_ROOT)) {
    throw new BadRequestException('Invalid file path');
  }
  return full;
}

// Deliberately a different prefix from the pre-existing MediaController
// (backend_nestjs/src/media/media.controller.ts, @Controller('media')) — that one
// already handles HLS video streaming tokens; this one is for everything else
// (chat images, PDFs, etc.) and needs to stay clearly distinct, not shadow it.
@Controller('secure-media')
export class MediaAccessController {
  constructor(private readonly mediaAccessService: MediaAccessService) {}

  /**
   * Mints a short-lived token for one specific file, scoped to the requesting user.
   * Requires a normal login session (Authorization header) — only /file below is
   * meant to be hit directly as a <img>/<video> src, without headers.
   */
  @UseGuards(JwtAuthGuard)
  @Get('sign')
  sign(@Query('path') path: string, @Request() req: any) {
    if (!path) throw new BadRequestException('path is required');
    resolveSafePath(path); // validates it stays inside uploads/ before minting anything
    const userId = Number(req.user.id || req.user._id);
    return { success: true, ...this.mediaAccessService.signMediaToken(userId, path) };
  }

  /** The actual file, gated by the short-lived token minted above — no Authorization header involved. */
  @Get('file')
  serveFile(@Query('path') path: string, @Query('token') token: string, @Query('download') download: string, @Res() res: Response) {
    if (!path || !token) throw new BadRequestException('path and token are required');
    this.mediaAccessService.verifyMediaToken(token, path);

    const fullPath = resolveSafePath(path);
    if (!existsSync(fullPath)) throw new NotFoundException('File not found');

    const contentType = CONTENT_TYPES[extname(fullPath).toLowerCase()] || 'application/octet-stream';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', download === 'true' ? 'attachment' : 'inline');
    res.setHeader('Cache-Control', 'private, max-age=0, no-store');
    res.sendFile(fullPath);
  }
}
