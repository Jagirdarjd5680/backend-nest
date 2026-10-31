import { Injectable, BadRequestException, NotFoundException, ForbiddenException, InternalServerErrorException, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MediaService } from '../media/media.service';
import { R2Service } from '../r2/r2.service'; // [r2]
import { VideoAgentService } from '../video-agent/video-agent.service';
import { UploadChunkDto } from './dto/upload-chunk.dto';
import { QueryUploadsDto } from './dto/query-uploads.dto';
import { BulkDeleteDto } from './dto/bulk-delete.dto';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class UploadsService {
  private readonly uploadsDir = path.join(process.cwd(), 'uploads');

  constructor(
    private readonly prisma: PrismaService,
    private readonly mediaService: MediaService,
    @Optional() private readonly r2?: R2Service, // [r2]
    @Optional() private readonly videoAgent?: VideoAgentService,
  ) {
    if (!fs.existsSync(this.uploadsDir)) {
      fs.mkdirSync(this.uploadsDir, { recursive: true });
    }
  }

  /**
   * Runs HLS conversion in the background. Must start only AFTER the media row with this videoId
   * is saved — otherwise a short video finishes first and its "ready" update matches no row,
   * leaving the card stuck at "converting 1%" forever.
   */
  private startHlsConversion(rawPath: string, videoId: string) {
    let lastPct = 0;
    this.mediaService
      .processVideoToHls(rawPath, videoId, async (pct) => {
        if (pct <= lastPct) return; // progress writes are async — never let an older one win
        lastPct = pct;
        await this.prisma.media.updateMany({ where: { videoId, status: 'processing' }, data: { processingProgress: pct } });
      })
      .then(async (res) => {
        await this.prisma.media.updateMany({
          where: { videoId },
          data: {
            url: res.streamUrl,
            thumbnailUrl: res.thumbnailUrl,
            status: 'ready',
            format: 'm3u8',
            processingProgress: 100,
            ...(res.durationSec > 0 ? { duration: res.durationSec } : {}),
          },
        });
        // [r2] move the encrypted chunks to the bucket (playlists + keys stay here)
        this.r2
          ?.offloadHlsSegments(videoId, path.join(process.cwd(), 'uploads', 'hls'), path.join(process.cwd(), 'storage', 'hls_keys'))
          .catch(() => {});
      })
      .catch(async (err: any) => {
        console.error(`❌ [Upload] HLS conversion failed videoId=${videoId}:`, err?.message);
        await this.prisma.media
          .updateMany({ where: { videoId }, data: { status: 'failed', failureReason: String(err?.message || 'Conversion failed').slice(0, 250) } })
          .catch(() => {});
      });
  }

  /**
   * Helper: Write a chunk buffer to a file at a specific offset
   */
  private async writeChunkAtOffset(filePath: string, buffer: Buffer, offset: number): Promise<void> {
    let fd: fs.promises.FileHandle | null = null;
    try {
      fd = await fs.promises.open(filePath, 'r+');
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fd = await fs.promises.open(filePath, 'w+');
      } else {
        throw err;
      }
    }

    try {
      await fd.write(buffer, 0, buffer.length, offset);
    } finally {
      if (fd) {
        await fd.close();
      }
    }
  }

  /**
   * Direct Single File Upload
   */
  async handleDirectUpload(file: any, body: { title?: string; courseId?: string } = {}, userId?: string) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    const fileName = `${Date.now()}_${file.originalname || file.filename || 'file'}`;
    const mimetype = file.mimetype || '';
    let resourceType = 'raw';

    if (mimetype.startsWith('video') || mimetype.startsWith('audio')) {
      resourceType = 'video';
    } else if (mimetype.startsWith('image')) {
      resourceType = 'image';
    } else if (mimetype.includes('pdf')) {
      resourceType = 'pdf';
    }

    // [r2] when enabled in settings, the file goes to the bucket instead of local disk
    const bucketUrl = file.buffer
      ? await this.r2?.tryOffloadBuffer(file.buffer, fileName, mimetype, { isVideo: resourceType === 'video' && !mimetype.startsWith('audio') })
      : null;

    const rawFilePath = path.join(this.uploadsDir, fileName);
    if (file.buffer && !bucketUrl) {
      if (!fs.existsSync(this.uploadsDir)) {
        fs.mkdirSync(this.uploadsDir, { recursive: true });
      }
      fs.writeFileSync(rawFilePath, file.buffer);
    }

    let uploadedUrl = bucketUrl || `/uploads/${fileName}`;
    let videoId: string | undefined = undefined;

    if (resourceType === 'video' && !mimetype.startsWith('audio') && !bucketUrl) {
      videoId = `video_${Date.now()}`;
      uploadedUrl = `/api/media/stream/${videoId}/master.m3u8`;

    }

    const safeTitle = (body && body.title) ? body.title : (file.originalname || fileName);
    const safeCourseId = (body && body.courseId) ? String(body.courseId) : null;

    const media = await this.prisma.media.create({
      data: {
        name: safeTitle,
        title: safeTitle,
        url: uploadedUrl,
        fileUrl: uploadedUrl,
        type: resourceType,
        format: resourceType === 'video' && !bucketUrl ? 'm3u8' : path.extname(file.originalname || fileName).replace('.', ''),
        status: resourceType === 'video' && !bucketUrl ? 'processing' : 'ready',
        size: BigInt(file.size || 0),
        videoId: videoId || null,
        uploadedById: userId ? String(userId) : null,
        courseId: safeCourseId,
        processingProgress: resourceType === 'video' && !bucketUrl ? 1 : 100,
      },
    });
    if (videoId) this.startHlsConversion(rawFilePath, videoId);

    return {
      success: true,
      url: uploadedUrl,
      resource_type: resourceType,
      format: media.format,
      id: media.id,
      message: 'Upload complete',
    };
  }

  /**
   * Links an external URL (CDN asset, hosted PDF, etc.) into the media library without
   * copying any bytes onto this server — mirrors handleDirectUpload's Media row shape so
   * imported assets show up in the library identically to uploaded ones.
   */
  async importUrl(body: { title?: string; url?: string; type?: string }, userId?: string) {
    const { url, type } = body || {};
    if (!url) {
      throw new BadRequestException('URL is required');
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      throw new BadRequestException('Enter a valid, fully-qualified URL (including https://)');
    }

    // Title is optional in the admin UI — fall back to the URL's filename so the record
    // still gets a sensible display name instead of erroring for a field that isn't
    // marked required on screen.
    const title = body?.title?.trim() || decodeURIComponent(parsedUrl.pathname.split('/').pop() || 'Imported Asset');

    let resourceType = type || 'raw';
    if (!type) {
      const ext = path.extname(parsedUrl.pathname).toLowerCase();
      if (['.mp4', '.mkv', '.mov', '.avi', '.webm', '.m3u8'].includes(ext)) resourceType = 'video';
      else if (['.mp3', '.wav', '.aac', '.m4a'].includes(ext)) resourceType = 'audio';
      else if (['.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg'].includes(ext)) resourceType = 'image';
      else if (ext === '.pdf') resourceType = 'pdf';
    }

    const media = await this.prisma.media.create({
      data: {
        name: title,
        title,
        url,
        fileUrl: url,
        type: resourceType,
        format: 'external',
        status: 'ready',
        size: BigInt(0),
        uploadedById: userId ? String(userId) : null,
        processingProgress: 100,
      },
    });

    return { success: true, data: { ...media, size: Number(media.size) } };
  }

  /**
   * Chunked Offset Upload
   */
  async handleChunkUpload(file: any, dto: UploadChunkDto, userId: string) {
    if (!file) {
      throw new BadRequestException('No chunk file provided');
    }

    const { fileName, chunkIndex, totalChunks, chunkSize, fileSize, uploadId, courseId, title } = dto;
    const chunkBuffer = file.buffer;
    const currentChunkSize = chunkBuffer.length;

    if (chunkIndex < 0 || totalChunks <= 0 || chunkIndex >= totalChunks) {
      throw new BadRequestException('Invalid chunk index or total chunks');
    }

    const cleanFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
    const finalFileName = `upload_${uploadId}_${cleanFileName}`;
    const finalPath = path.join(this.uploadsDir, finalFileName);

    const standardChunkSize = (chunkSize && chunkSize > 0) ? chunkSize : currentChunkSize;
    const offset = chunkIndex * standardChunkSize;

    // Write chunk at offset
    await this.writeChunkAtOffset(finalPath, chunkBuffer, offset);

    let resourceType = 'raw';
    if (fileName.match(/\.(mp4|mkv|mov|avi|mp3|wav)$/i)) resourceType = 'video';
    else if (fileName.match(/\.(jpg|jpeg|png|webp|gif)$/i)) resourceType = 'image';
    else if (fileName.match(/\.pdf$/i)) resourceType = 'pdf';

    // Update or create Media database record. The client sends chunks in parallel, so the
    // counter must be an atomic increment and two "first" chunks may race on the create.
    const increment = () => this.prisma.media.update({ where: { uploadId }, data: { uploadedChunks: { increment: 1 } } });
    let media = await this.prisma.media.findUnique({ where: { uploadId } });

    if (!media) {
      try {
        media = await this.prisma.media.create({
          data: {
            name: title || fileName,
            url: `pending_${uploadId}`,
            type: resourceType,
            format: 'temp',
            status: 'uploading',
            size: BigInt(fileSize && fileSize > 0 ? fileSize : 0),
            uploadedById: userId != null ? String(userId) : null,
            courseId: courseId ? String(courseId) : null,
            uploadId,
            totalChunks,
            uploadedChunks: 1,
            processingProgress: 1,
          },
        });
      } catch (err: any) {
        if (err?.code !== 'P2002') throw err;
        media = await increment(); // another chunk created the row first
      }
    } else {
      media = await increment();
    }

    const completedChunks = media.uploadedChunks || 1;
    // Clients send the last chunk only after every other chunk succeeded, so it finishes the
    // upload. (Not the counter: a retried chunk that had actually landed would count twice.)
    const isCompleted = chunkIndex === totalChunks - 1;

    if (isCompleted) {
      const actualSize = fs.existsSync(finalPath) ? fs.statSync(finalPath).size : fileSize;
      const ext = path.extname(fileName).toLowerCase();

      const isHlsVideo = resourceType === 'video' && !ext.match(/\.(mp3|wav)$/i);
      // [r2] when enabled in settings, move the assembled file to the bucket
      const bucketUrl = await this.r2?.tryOffloadFile(finalPath, finalFileName, { isVideo: isHlsVideo });

      let finalUrl = bucketUrl || `/uploads/${finalFileName}`;
      let videoId: string | undefined = undefined;

      if (isHlsVideo && !bucketUrl) {
        videoId = `video_${Date.now()}`;
        finalUrl = `/api/media/stream/${videoId}/master.m3u8`;

      }

      const updated = await this.prisma.media.updateMany({
        where: { uploadId },
        data: {
          url: finalUrl,
          size: BigInt(actualSize || 0),
          format: videoId ? 'm3u8' : ext.replace('.', ''),
          status: videoId ? 'processing' : 'ready',
          videoId,
          processingProgress: videoId ? 1 : 100,
        },
      });
      // The row was deleted from the library while the file was still being finalized —
      // discard the file instead of leaving it orphaned on disk / in the bucket.
      if (!updated.count) {
        if (bucketUrl) await this.r2?.deleteByUrl(bucketUrl); // [r2]
        else if (fs.existsSync(finalPath)) fs.promises.unlink(finalPath).catch(() => {});
        return { success: true, message: 'Upload discarded — the file was deleted from the library', progress: 100 };
      }
      if (videoId) this.startHlsConversion(finalPath, videoId);

      // Same shape as handleDirectUpload, so callers can read `url` whatever the file size.
      return {
        success: true,
        url: finalUrl,
        resource_type: resourceType,
        format: videoId ? 'm3u8' : ext.replace('.', ''),
        id: media.id,
        message: 'Upload complete',
        progress: 100,
      };
    }

    return {
      success: true,
      message: `Chunk ${chunkIndex} uploaded successfully`,
      progress: Math.round((completedChunks / totalChunks) * 100),
    };
  }

  /**
   * List Uploaded Files
   */
  async findAll(queryDto: QueryUploadsDto, user: { id: string; role: string }) {
    const page = Math.max(1, queryDto.page || 1);
    const limit = Math.max(1, queryDto.limit || 12);
    const skip = (page - 1) * limit;

    const where: any = {};

    if (queryDto.courseId) {
      where.courseId = queryDto.courseId;
    }

    if (user.role === 'teacher') {
      where.uploadedById = user.id;
    } else if (user.role === 'admin' && queryDto.userId) {
      where.uploadedById = queryDto.userId;
    }

    const [total, files] = await Promise.all([
      this.prisma.media.count({ where }),
      this.prisma.media.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    const healed: string[] = [];
    const formattedFiles = files.map((m) => {
      let finalUrl = m.url;
      if (finalUrl && finalUrl.includes('/api/media/stream/')) {
        const videoFolder = path.join(process.cwd(), 'uploads', 'hls', m.videoId || '');
        if (!fs.existsSync(videoFolder)) {
          finalUrl = `/uploads/${path.basename(m.name)}`;
        }
      }
      // Self-heal rows left at "processing" although conversion already finished on disk.
      if (m.status === 'processing' && m.videoId && this.mediaService.isHlsReady(m.videoId)) {
        healed.push(m.videoId);
        return { ...m, status: 'ready', url: finalUrl, fileUrl: finalUrl, processingProgress: 100,
          thumbnailUrl: m.thumbnailUrl || `/uploads/thumbnails/${m.videoId}.jpg`, size: m.size ? m.size.toString() : '0' };
      }
      // Local-agent jobs (jobId set) report progress into the row; only VPS conversions are live in memory.
      const liveProgress = m.status === 'processing' && m.videoId && !m.jobId ? this.mediaService.getHlsProgress(m.videoId) : 0;
      const progress = liveProgress > 0 ? liveProgress : (m.processingProgress || 0);

      return {
        ...m,
        url: finalUrl,
        fileUrl: finalUrl,
        thumbnailUrl: m.thumbnailUrl || (m.videoId ? `/uploads/thumbnails/${m.videoId}.jpg` : null),
        processingProgress: progress,
        size: m.size ? m.size.toString() : '0',
      };
    });

    if (healed.length) {
      await this.prisma.media.updateMany({
        where: { videoId: { in: healed }, status: 'processing' },
        data: { status: 'ready', processingProgress: 100 },
      });
    }

    // [r2] tag videos whose encrypted chunks live in the bucket (for the CLOUD badge)
    const hlsBase = path.join(process.cwd(), 'uploads', 'hls');
    const data = formattedFiles.map((f) =>
      f.videoId && this.r2?.hlsInBucket(f.videoId, hlsBase) ? { ...f, storageProvider: 'r2' } : f,
    );

    return {
      success: true,
      total,
      page,
      totalPages: Math.ceil(total / limit),
      count: data.length,
      data,
    };
  }

  /**
   * Get Storage Stats
   */
  async getStats() {
    const totalFiles = await this.prisma.media.count();
    const typeBreakdown = await this.prisma.media.groupBy({
      by: ['type'],
      _count: true,
      _sum: { size: true },
    });

    const breakdown = typeBreakdown.map((item) => ({
      type: item.type,
      count: item._count,
      totalBytes: item._sum.size ? item._sum.size.toString() : '0',
    }));

    return {
      success: true,
      totalFiles,
      breakdown,
    };
  }

  /**
   * Bulk Delete Files
   */
  async bulkDelete(dto: BulkDeleteDto, user: { id: string; role: string }) {
    const files = await this.prisma.media.findMany({
      where: { name: { in: dto.fileNames } },
    });

    for (const file of files) {
      if (user.role !== 'admin' && file.uploadedById !== user.id) {
        continue;
      }
      await this.r2?.deleteByUrl(file.url); // [r2] no-op for local files
      // file.name is the display title (e.g. "photo.jpg"), not the on-disk filename —
      // the actual saved file lives at the basename of file.url (e.g. "1699999999_photo.jpg").
      const diskFileName = file.url ? path.basename(file.url) : file.name;
      const filePath = path.join(this.uploadsDir, diskFileName);
      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
        } catch (e) {}
      }
      if (file.videoId) {
        await this.videoAgent?.cancelForVideo(file.videoId); // stop a local-agent job still running
        this.mediaService.deleteHlsKey(file.videoId);
        this.r2?.deleteHlsSegments(file.videoId); // [r2]
        const hlsFolder = path.join(process.cwd(), 'uploads', 'hls', file.videoId);
        if (fs.existsSync(hlsFolder)) {
          try {
            fs.rmSync(hlsFolder, { recursive: true, force: true });
          } catch (e) {}
        }
        const thumbFile = path.join(this.uploadsDir, 'thumbnails', `${file.videoId}.jpg`);
        if (fs.existsSync(thumbFile)) {
          try {
            fs.unlinkSync(thumbFile);
          } catch (e) {}
        }
      }
    }

    await this.prisma.media.deleteMany({
      where: {
        name: { in: dto.fileNames },
        ...(user.role !== 'admin' ? { uploadedById: user.id } : {}),
      },
    });

    return { success: true, message: 'Files deleted successfully' };
  }

  /**
   * Single File Delete
   */
  async remove(filename: string, user: { id: string; role: string }) {
    // `filename` may be either the display title (media.name) or the on-disk name
    // (basename of media.url) depending on the caller — accept both.
    let media = await this.prisma.media.findFirst({ where: { name: filename } });
    if (!media) {
      media = await this.prisma.media.findFirst({ where: { url: { endsWith: `/${filename}` } } });
    }

    if (!media) {
      throw new NotFoundException('File not found');
    }

    if (media.uploadedById !== user.id && user.role !== 'admin') {
      throw new ForbiddenException('You do not have permission to delete this file');
    }

    await this.r2?.deleteByUrl(media.url); // [r2] no-op for local files

    const diskFileName = media.url ? path.basename(media.url) : filename;
    const filePath = path.join(this.uploadsDir, diskFileName);
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (e) {}
    }

    if (media.videoId) {
      await this.videoAgent?.cancelForVideo(media.videoId); // stop a local-agent job still running
      this.mediaService.deleteHlsKey(media.videoId);
      this.r2?.deleteHlsSegments(media.videoId); // [r2]
      const hlsFolder = path.join(process.cwd(), 'uploads', 'hls', media.videoId);
      if (fs.existsSync(hlsFolder)) {
        try {
          fs.rmSync(hlsFolder, { recursive: true, force: true });
        } catch (e) {}
      }
      const thumbFile = path.join(this.uploadsDir, 'thumbnails', `${media.videoId}.jpg`);
      if (fs.existsSync(thumbFile)) {
        try {
          fs.unlinkSync(thumbFile);
        } catch (e) {}
      }
    }

    await this.prisma.media.delete({ where: { id: media.id } });

    return { success: true, message: 'File deleted successfully' };
  }
}
