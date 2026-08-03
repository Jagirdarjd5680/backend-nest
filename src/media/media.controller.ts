import {
  Controller,
  Post,
  Get,
  Param,
  Query,
  Res,
  UseGuards,
  Request,
  Header,
  ForbiddenException,
} from '@nestjs/common';
import { Response } from 'express';
import { JwtService } from '@nestjs/jwt';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { MediaService } from './media.service';

@Controller('media')
export class MediaController {
  constructor(
    private readonly mediaService: MediaService,
    private readonly jwtService: JwtService,
  ) {}

  @UseGuards(JwtAuthGuard)
  @Post('token/:videoId')
  async issueToken(@Param('videoId') videoId: string, @Request() req: any) {
    const userId = req.user?.id || req.user?._id || 'system';
    return this.mediaService.issueToken(videoId, String(userId));
  }

  @Get('verify-token')
  async verifyToken(@Query('token') token: string, @Query('videoId') videoId: string, @Res() res: Response) {
    const isValid = this.mediaService.validateToken(token, videoId);
    if (isValid) {
      return res.sendStatus(200);
    }
    console.warn(`🚫 [Video] verify-token REJECTED videoId=${videoId}`);
    return res.sendStatus(403);
  }

  /**
   * Two ways to prove you're allowed to see this stream: the native app's
   * short-lived per-video playback token (query param), or the admin
   * frontend's full JWT session (Authorization header — hls.js's `xhrSetup`
   * sets this on every request, it doesn't know about the query-token scheme).
   * Either one on its own used to be optional; now at least one is required.
   */
  private assertAuthorized(req: any, token: string | undefined, videoId: string): void {
    const authHeader = req?.headers?.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      try {
        this.jwtService.verify(authHeader.slice(7));
        return;
      } catch {
        // fall through to token check
      }
    }
    if (!this.mediaService.validateToken(token || '', videoId)) {
      console.warn(`🚫 [Video] Stream request REJECTED videoId=${videoId} path=${req?.originalUrl ?? req?.url ?? '?'}`);
      throw new ForbiddenException('Missing or expired playback token');
    }
  }

  @Get('stream/:videoId/master.m3u8')
  @Header('Content-Type', 'application/vnd.apple.mpegurl')
  @Header('Cache-Control', 'no-cache, no-store')
  async getMasterPlaylist(@Param('videoId') videoId: string, @Query('token') token: string, @Request() req: any) {
    this.assertAuthorized(req, token, videoId);
    return this.mediaService.getMasterPlaylist(videoId, token);
  }

  @Get('stream/:videoId/index.m3u8')
  @Header('Content-Type', 'application/vnd.apple.mpegurl')
  @Header('Cache-Control', 'no-cache, no-store')
  async getIndexPlaylist(@Param('videoId') videoId: string, @Query('token') token: string, @Request() req: any) {
    this.assertAuthorized(req, token, videoId);
    return this.mediaService.getMasterPlaylist(videoId, token);
  }

  @Get('stream/:videoId/:segment')
  async getSegment(
    @Param('videoId') videoId: string,
    @Param('segment') segment: string,
    @Query('token') token: string,
    @Request() req: any,
    @Res() res: Response,
  ) {
    this.assertAuthorized(req, token, videoId);
    if (segment.endsWith('.m3u8')) {
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      const playlist = await this.mediaService.getMasterPlaylist(videoId, token);
      return res.send(playlist);
    }
    res.setHeader('Content-Type', 'video/MP2T');
    const segmentPath = this.mediaService.getSegmentPath(videoId, segment);
    return res.sendFile(segmentPath);
  }

  @Get('stream/:videoId/:quality/playlist.m3u8')
  @Header('Content-Type', 'application/vnd.apple.mpegurl')
  @Header('Cache-Control', 'no-cache, no-store')
  async getQualityPlaylist(
    @Param('videoId') videoId: string,
    @Param('quality') quality: string,
    @Query('token') token: string,
    @Request() req: any,
  ) {
    this.assertAuthorized(req, token, videoId);
    return this.mediaService.getQualityPlaylist(videoId, quality, token);
  }

  // Nothing currently generates links to this route (the one caller, utils/storage.js,
  // is dead/unimported legacy code from before the Prisma migration) — but the route
  // itself was still live and completely unguarded, serving any uploads/ filename to
  // anyone who could guess or discover it. Require a real login session at minimum.
  @UseGuards(JwtAuthGuard)
  @Get('file/:filename')
  async getFile(@Param('filename') filename: string, @Res() res: Response) {
    const filePath = this.mediaService.getFilePath(filename);
    return res.sendFile(filePath);
  }
}
