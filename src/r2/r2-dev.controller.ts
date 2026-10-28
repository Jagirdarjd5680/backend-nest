import { BadRequestException, Body, Controller, Delete, Get, NotFoundException, Param, Post, Query, Req, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { MediaService } from '../media/media.service';
import { UploadsService } from '../uploads/uploads.service';
import { FileInterceptor } from '@nestjs/platform-express';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import * as multer from 'multer';
import { R2Service } from './r2.service';
import { R2_TEST_PAGE } from './r2-test-page';

/**
 * Local-only test page: http://localhost:5001/api/r2/dev
 * Upload any file straight to the bucket and see the bucket's contents — no login.
 *
 * Off unless R2_DEV_PAGE=true in .env, and even then only answers requests made on this machine
 * to a localhost Host. (The localhost check alone isn't enough: a proxy that forwards with its
 * own Host header, or shared hosting's Node runner, also looks local.)
 */
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

function assertLocal(req: Request) {
  if (process.env.R2_DEV_PAGE !== 'true') throw new NotFoundException();
  const ip = req.socket?.remoteAddress || '';
  if (!LOOPBACK.has(ip) || !LOCAL_HOST.test(String(req.headers.host || ''))) throw new NotFoundException();
}

@SkipThrottle()
@Controller('r2/dev')
export class R2DevController {
  constructor(
    private readonly service: R2Service,
    private readonly prisma: PrismaService,
    private readonly mediaService: MediaService,
    private readonly moduleRef: ModuleRef,
  ) {}

  private async adminId() {
    const admin = await this.prisma.user.findFirst({ where: { role: 'admin' }, select: { id: true } });
    return admin ? Number(admin.id) : null;
  }

  /**
   * Progress of a video sent through the real pipeline by the upload route below:
   * converting (HLS %) → moving (encrypted chunks going to the bucket) → done.
   */
  @Get('media-status/:id')
  async mediaStatus(@Req() req: Request, @Param('id') id: string) {
    assertLocal(req);
    const m = await this.prisma.media.findUnique({
      where: { id },
      select: { name: true, url: true, status: true, processingProgress: true, videoId: true, failureReason: true },
    });
    if (!m) return { phase: 'gone' };
    if (m.status === 'failed') return { phase: 'failed', message: m.failureReason || 'Conversion failed' };
    if (m.status === 'uploading') return { phase: 'storing' }; // last chunk received, file being moved to the bucket
    if (!m.videoId) return { phase: 'done', name: m.name, url: m.url, inBucket: String(m.url || '').includes('/api/r2/file/') };
    if (m.status !== 'ready') {
      const live = this.mediaService.getHlsProgress(m.videoId);
      return { phase: 'converting', percent: Math.max(live || 0, m.processingProgress || 0), videoId: m.videoId };
    }
    let local = 0;
    const walk = (d: string) => {
      if (!fs.existsSync(d)) return;
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (e.isDirectory()) walk(path.join(d, e.name));
        else if (e.name.endsWith('.ts')) local++;
      }
    };
    walk(path.join(process.cwd(), 'uploads', 'hls', m.videoId));
    const inBucket = await this.service.countHlsChunks(m.videoId);
    const { uploadVideos, enabled } = await this.service.getConfig();
    if (!enabled || !uploadVideos) return { phase: 'local', videoId: m.videoId, local };
    return { phase: local > 0 ? 'moving' : 'done', videoId: m.videoId, inBucket, local };
  }

  /**
   * Secure playback for a video whose encrypted chunks are in the bucket: a normal playback
   * token minted for an admin (who can watch everything), plus whether the server still has
   * the pieces that never leave it (decryption key + playlist) and the video's library name.
   */
  @Get('play/:videoId')
  async play(@Req() req: Request, @Param('videoId') videoId: string) {
    assertLocal(req);
    if (!/^[\w-]+$/.test(videoId)) throw new NotFoundException();
    const keyPresent = fs.existsSync(path.join(process.cwd(), 'storage', 'hls_keys', `${videoId}.key`));
    const playlistPresent = fs.existsSync(path.join(process.cwd(), 'uploads', 'hls', videoId, 'master.m3u8'));
    const row = await this.prisma.media.findFirst({ where: { videoId }, select: { title: true, name: true } });
    const status = { keyPresent, playlistPresent, name: row?.title || row?.name || null };
    if (!keyPresent || !playlistPresent) return { success: false, ...status };

    const admin = await this.adminId();
    if (!admin) return { success: false, ...status, message: 'No admin user found to watch as' };
    try {
      return { ...(await this.mediaService.issueToken(videoId, admin)), ...status };
    } catch (err: any) {
      return { success: false, message: err?.message || 'Could not start playback' };
    }
  }

  @Get()
  page(@Req() req: Request, @Res() res: Response) {
    assertLocal(req);
    res.type('html').send(R2_TEST_PAGE);
  }

  @Get('info')
  async info(@Req() req: Request) {
    assertLocal(req);
    return this.service.getMaskedConfig();
  }

  @Post('check')
  async check(@Req() req: Request) {
    assertLocal(req);
    return this.service.testConnection();
  }

  @Get('list')
  async list(@Req() req: Request) {
    assertLocal(req);
    try {
      const items = await this.service.listObjects();
      return { success: true, items, totalBytes: items.reduce((s, i) => s + i.size, 0) };
    } catch (err: any) {
      return { success: false, message: err?.message };
    }
  }

  /**
   * Chunked upload through the real Media Library path (UploadsService.handleChunkUpload) — no
   * overall size limit and low memory. Videos → encrypted HLS → chunks to the bucket; other files
   * → bucket. The page sends chunks one at a time (the chunk counter isn't safe for parallel).
   */
  @Post('chunk')
  @UseInterceptors(FileInterceptor('chunk', { storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } }))
  async chunk(@Req() req: Request, @UploadedFile() file: any, @Body() body: any) {
    assertLocal(req);
    const uploadId = String(body?.uploadId || '');
    if (!file || !/^[\w-]{6,64}$/.test(uploadId)) throw new BadRequestException('chunk and uploadId are required');
    const admin = await this.adminId();
    if (!admin) return { success: false, message: 'No admin user found to upload as' };
    const dto: any = {
      fileName: String(body.fileName || 'file'),
      title: String(body.fileName || 'file'),
      chunkIndex: Number(body.chunkIndex),
      totalChunks: Number(body.totalChunks),
      chunkSize: Number(body.chunkSize),
      fileSize: Number(body.fileSize),
      uploadId,
    };
    const uploads = this.moduleRef.get(UploadsService, { strict: false });
    try {
      const r: any = await uploads.handleChunkUpload(file, dto, String(admin));
      const last = dto.chunkIndex === dto.totalChunks - 1;
      const media = last ? await this.prisma.media.findUnique({ where: { uploadId }, select: { id: true } }) : null;
      return { ...r, mediaId: media?.id || null };
    } catch (err: any) {
      return { success: false, message: err?.message };
    }
  }

  /** Removes every bucket chunk of one video (bucket only — the library row is untouched). */
  @Delete('video')
  async removeVideo(@Req() req: Request, @Query('videoId') videoId: string) {
    assertLocal(req);
    if (!videoId || !/^[\w-]+$/.test(videoId)) throw new BadRequestException('videoId is required');
    await this.service.deleteHlsSegments(videoId);
    return { success: true };
  }

  @Delete('object')
  async remove(@Req() req: Request, @Query('key') key: string) {
    assertLocal(req);
    if (!key) throw new BadRequestException('key is required');
    try {
      await this.service.deleteKey(key);
      return { success: true };
    } catch (err: any) {
      return { success: false, message: err?.message };
    }
  }
}
