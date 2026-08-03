import { Injectable, BadRequestException, NotFoundException, ForbiddenException, InternalServerErrorException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MediaService } from '../media/media.service';
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
  ) {
    if (!fs.existsSync(this.uploadsDir)) {
      fs.mkdirSync(this.uploadsDir, { recursive: true });
    }
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
    console.log(`📂 [UploadService] Received file for direct upload: ${file?.originalname} (${file?.size} bytes)`);
    if (!file) {
      console.error(`❌ [UploadService] No file payload provided in request`);
      throw new BadRequestException('No file uploaded');
    }

    const fileName = `${Date.now()}_${file.originalname || file.filename || 'file'}`;
    const mimetype = file.mimetype || '';
    let resourceType = 'raw';

    const rawFilePath = path.join(this.uploadsDir, fileName);
    if (file.buffer) {
      if (!fs.existsSync(this.uploadsDir)) {
        fs.mkdirSync(this.uploadsDir, { recursive: true });
      }
      fs.writeFileSync(rawFilePath, file.buffer);
      console.log(`✅ [UploadService] Raw file written to disk: ${rawFilePath}`);
    }

    if (mimetype.startsWith('video') || mimetype.startsWith('audio')) {
      resourceType = 'video';
    } else if (mimetype.startsWith('image')) {
      resourceType = 'image';
    } else if (mimetype.includes('pdf')) {
      resourceType = 'pdf';
    }

    let uploadedUrl = `/uploads/${fileName}`;
    let videoId: string | undefined = undefined;

    if (resourceType === 'video' && !mimetype.startsWith('audio')) {
      videoId = `video_${Date.now()}`;
      uploadedUrl = `/api/media/stream/${videoId}/master.m3u8`;

      // Trigger background HLS video transcoding & delete raw video file on completion
      this.mediaService.processVideoToHls(rawFilePath, videoId, async (pct) => {
        await this.prisma.media.updateMany({
          where: { videoId },
          data: { processingProgress: pct },
        });
      }).then(async (res) => {
        await this.prisma.media.updateMany({
          where: { videoId },
          data: {
            url: res.streamUrl,
            thumbnailUrl: res.thumbnailUrl,
            status: 'ready',
            format: 'm3u8',
            processingProgress: 100,
          },
        });
        console.log(`🎬 [UploadService] Video ${videoId} HLS conversion ready at ${res.streamUrl}`);
      }).catch(err => {
        console.error(`❌ [UploadService] HLS video processing failed for ${videoId}:`, err);
      });
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
        format: resourceType === 'video' ? 'm3u8' : path.extname(file.originalname || fileName).replace('.', ''),
        status: resourceType === 'video' ? 'processing' : 'ready',
        size: BigInt(file.size || 0),
        videoId: videoId || null,
        uploadedById: userId ? String(userId) : null,
        courseId: safeCourseId,
        processingProgress: resourceType === 'video' ? 1 : 100,
      },
    });

    console.log(`🎉 [UploadService] Created media record in database ID: ${media.id}, URL: ${uploadedUrl}`);

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
      console.error(`❌ [UploadService] import-url missing required field: url`);
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

    console.log(`🔗 [UploadService] Imported external URL as media ID: ${media.id} (${resourceType}) -> ${url}`);

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

    // Update or create Media database record
    let media = await this.prisma.media.findUnique({ where: { uploadId } });

    if (!media) {
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
    } else {
      const currentUploaded = (media.uploadedChunks || 0) + 1;
      media = await this.prisma.media.update({
        where: { uploadId },
        data: {
          uploadedChunks: currentUploaded,
        },
      });
    }

    const completedChunks = media.uploadedChunks || 1;
    const isCompleted = completedChunks >= totalChunks;

    if (isCompleted) {
      const actualSize = fs.existsSync(finalPath) ? fs.statSync(finalPath).size : fileSize;
      const ext = path.extname(fileName).toLowerCase();

      let finalUrl = `/uploads/${finalFileName}`;
      let videoId: string | undefined = undefined;

      if (resourceType === 'video' && !ext.match(/\.(mp3|wav)$/i)) {
        videoId = `video_${Date.now()}`;
        finalUrl = `/api/media/stream/${videoId}/master.m3u8`;

        // Trigger background HLS video transcoding for chunked upload & delete raw video file on completion
        this.mediaService.processVideoToHls(finalPath, videoId, async (pct) => {
          await this.prisma.media.updateMany({
            where: { videoId },
            data: { processingProgress: pct },
          });
        }).then(async (res) => {
          await this.prisma.media.updateMany({
            where: { videoId },
            data: {
              url: res.streamUrl,
              thumbnailUrl: res.thumbnailUrl,
              status: 'ready',
              format: 'm3u8',
              processingProgress: 100,
            },
          });
          console.log(`🎬 [UploadService] Chunked video ${videoId} HLS conversion ready at ${res.streamUrl}`);
        }).catch(err => {
          console.error(`❌ [UploadService] HLS chunked video processing failed for ${videoId}:`, err);
        });
      }

      media = await this.prisma.media.update({
        where: { uploadId },
        data: {
          url: finalUrl,
          size: BigInt(actualSize || 0),
          format: resourceType === 'video' ? 'm3u8' : ext.replace('.', ''),
          status: resourceType === 'video' ? 'processing' : 'ready',
          videoId,
          processingProgress: resourceType === 'video' ? 1 : 100,
        },
      });
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

    const formattedFiles = files.map((m) => {
      let finalUrl = m.url;
      if (finalUrl && finalUrl.includes('/api/media/stream/')) {
        const videoFolder = path.join(process.cwd(), 'uploads', 'hls', m.videoId || '');
        if (!fs.existsSync(videoFolder)) {
          finalUrl = `/uploads/${path.basename(m.name)}`;
        }
      }
      const liveProgress = m.videoId ? this.mediaService.getHlsProgress(m.videoId) : 0;
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

    return {
      success: true,
      total,
      page,
      totalPages: Math.ceil(total / limit),
      count: formattedFiles.length,
      data: formattedFiles,
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
      const filePath = path.join(this.uploadsDir, file.name);
      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
        } catch (e) {}
      }
      if (file.videoId) {
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
    const media = await this.prisma.media.findFirst({
      where: { name: filename },
    });

    if (!media) {
      throw new NotFoundException('File not found');
    }

    if (media.uploadedById !== user.id && user.role !== 'admin') {
      throw new ForbiddenException('You do not have permission to delete this file');
    }

    const filePath = path.join(this.uploadsDir, filename);
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (e) {}
    }

    if (media.videoId) {
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
