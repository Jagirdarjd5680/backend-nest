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
import { ENCRYPTED_SEGMENT_PREFIX } from './hls-security.service';

@Controller('media')
export class MediaController {
  constructor(
    private readonly mediaService: MediaService,
    private readonly jwtService: JwtService,
  ) {}

  @UseGuards(JwtAuthGuard)
  @Post('token/:videoId')
  async issueToken(@Param('videoId') videoId: string, @Request() req: any) {
    const userId = Number(req.user?.id || req.user?._id);
    if (!userId) throw new ForbiddenException('Login required');
    return this.mediaService.issueToken(videoId, userId);
  }

  @Get('verify-token')
  async verifyToken(@Query('token') token: string, @Query('videoId') videoId: string, @Res() res: Response) {
    if (this.mediaService.validateToken(token, videoId)) {
      res.sendStatus(200);
      return;
    }
    console.warn(`🚫 [Video] verify-token REJECTED videoId=${videoId}`);
    res.sendStatus(403);
  }

  /** User id from a login JWT in the Authorization header (admin hls.js sends it), if valid. */
  private headerUserId(req: any): number | null {
    const authHeader = req?.headers?.authorization;
    if (!authHeader?.startsWith('Bearer ')) return null;
    try {
      const payload: any = this.jwtService.verify(authHeader.slice(7));
      const id = Number(payload?.sub);
      return Number.isFinite(id) && id > 0 ? id : null;
    } catch {
      return null;
    }
  }

  /**
   * Two ways to prove you're allowed to see this stream: the per-video playback token (query
   * param — native app and student web), or a login JWT in the Authorization header (admin
   * hls.js). The header path is now also checked against enrollment, not just "is logged in".
   * Returns who is watching, so encrypted playlists can mint a key token for that user.
   */
  private async authorize(req: any, token: string | undefined, videoId: string): Promise<{ token?: string; userId: number }> {
    const tokenUser = token ? this.mediaService.validateToken(token, videoId) : null;
    if (tokenUser) return { token, userId: tokenUser };

    const headerUser = this.headerUserId(req);
    if (headerUser && (await this.mediaService.canAccess(headerUser, videoId))) {
      return { userId: headerUser };
    }

    console.warn(`🚫 [Video] Stream request REJECTED videoId=${videoId} path=${String(req?.originalUrl ?? req?.url ?? '?').split('?')[0]}`);
    throw new ForbiddenException('Missing or expired playback token');
  }

  @Get('stream/:videoId/master.m3u8')
  @Header('Content-Type', 'application/vnd.apple.mpegurl')
  @Header('Cache-Control', 'no-cache, no-store')
  async getMasterPlaylist(@Param('videoId') videoId: string, @Query('token') token: string, @Request() req: any) {
    return this.mediaService.getMasterPlaylist(videoId, await this.authorize(req, token, videoId));
  }

  @Get('stream/:videoId/index.m3u8')
  @Header('Content-Type', 'application/vnd.apple.mpegurl')
  @Header('Cache-Control', 'no-cache, no-store')
  async getIndexPlaylist(@Param('videoId') videoId: string, @Query('token') token: string, @Request() req: any) {
    return this.mediaService.getMasterPlaylist(videoId, await this.authorize(req, token, videoId));
  }

  /**
   * AES-128 key for an encrypted video. Fetched once per playback, right after the playlist.
   * Never cached anywhere, never shared between users (the key token is bound to one user).
   */
  @Get('key/:videoId')
  async getKey(@Param('videoId') videoId: string, @Query('kt') keyToken: string, @Request() req: any, @Res() res: Response) {
    const key = await this.mediaService.getKey(videoId, keyToken, this.headerUserId(req));
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    res.send(key);
  }

  @Get('stream/:videoId/:segment')
  async getSegment(
    @Param('videoId') videoId: string,
    @Param('segment') segment: string,
    @Query('token') token: string,
    @Request() req: any,
    @Res() res: Response,
  ) {
    const viewer = await this.authorize(req, token, videoId);
    if (segment.endsWith('.m3u8')) {
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.setHeader('Cache-Control', 'no-cache, no-store');
      res.send(await this.mediaService.getMasterPlaylist(videoId, viewer));
      return;
    }
    // Leftover plain segments of a video that has since been encrypted must never be served.
    if (this.mediaService.isEncrypted(videoId) && !segment.startsWith(ENCRYPTED_SEGMENT_PREFIX)) {
      throw new ForbiddenException('Segment not available');
    }
    res.setHeader('Content-Type', 'video/MP2T');
    return res.sendFile(this.mediaService.getSegmentPath(videoId, segment));
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
    return this.mediaService.getQualityPlaylist(videoId, quality, await this.authorize(req, token, videoId));
  }

  /** Per-quality chunks of an UNENCRYPTED video. Encrypted chunks are static (/hls-seg), never here. */
  @Get('stream/:videoId/:quality/:segment')
  async getQualitySegment(
    @Param('videoId') videoId: string,
    @Param('quality') quality: string,
    @Param('segment') segment: string,
    @Query('token') token: string,
    @Request() req: any,
    @Res() res: Response,
  ) {
    await this.authorize(req, token, videoId);
    if (this.mediaService.isEncrypted(videoId)) throw new ForbiddenException('Segment not available');
    res.setHeader('Content-Type', 'video/MP2T');
    return res.sendFile(this.mediaService.getQualitySegmentPath(videoId, quality, segment));
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
