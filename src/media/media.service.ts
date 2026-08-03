import { Injectable, NotFoundException, ForbiddenException, InternalServerErrorException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

// Use require for CJS compatibility with fluent-ffmpeg
const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');

if (ffmpegInstaller && ffmpegInstaller.path) {
  try {
    ffmpeg.setFfmpegPath(ffmpegInstaller.path);
    console.log(`🎬 [MediaService] FFmpeg binary path initialized: ${ffmpegInstaller.path}`);
  } catch (err: any) {
    console.warn(`⚠️ [MediaService] Failed to set FFmpeg path:`, err.message);
  }
}

const PLAYBACK_TOKEN_TTL = 4 * 60 * 60; // 4 hours in seconds

@Injectable()
export class MediaService {
  private readonly hlsBase = path.join(process.cwd(), 'uploads', 'hls');
  private readonly uploadsDir = path.join(process.cwd(), 'uploads');
  private tokenStore = new Map<string, { videoId: string; userId: string; expiresAt: number }>();
  private hlsProgressMap = new Map<string, number>();
  private hlsDurationMap = new Map<string, number>();

  constructor(private readonly prisma: PrismaService) {}

  private safeHlsPath(videoId: string, ...parts: string[]): string | null {
    const resolved = path.resolve(this.hlsBase, videoId, ...parts);
    const base = path.resolve(this.hlsBase) + path.sep;
    if (!resolved.startsWith(base)) return null;
    return resolved;
  }

  private appendQueryParam(uri: string, key: string, value: string): string {
    if (!uri || uri.startsWith('#') || uri.startsWith('data:')) return uri;
    const separator = uri.includes('?') ? '&' : '?';
    return `${uri}${separator}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
  }

  private appendPlaybackTokenToPlaylist(content: string, token: string): string {
    return content
      .split(/\r?\n/)
      .map((line) => {
        const trimmed = line.trim();
        if (trimmed.startsWith('#EXT-X-KEY') && trimmed.includes('URI="')) {
          return line.replace(/URI="([^"]+)"/, (_match, uri) => {
            if (uri.includes('token=')) return `URI="${uri}"`;
            return `URI="${this.appendQueryParam(uri, 'token', token)}"`;
          });
        }
        if (!trimmed || trimmed.startsWith('#')) return line;
        if (trimmed.includes('token=')) return line;
        return this.appendQueryParam(line, 'token', token);
      })
      .join('\n');
  }

  async issueToken(videoId: string, userId: string) {
    const token = crypto.randomBytes(24).toString('hex');
    const expiresAt = Date.now() + PLAYBACK_TOKEN_TTL * 1000;

    this.tokenStore.set(token, { videoId, userId, expiresAt });
    console.log(`🎫 [Video] Token issued videoId=${videoId} user=${userId}`);

    return {
      success: true,
      token,
      expiresIn: PLAYBACK_TOKEN_TTL,
      streamUrl: `/api/media/stream/${videoId}/master.m3u8?token=${token}`,
    };
  }

  validateToken(token: string, videoId: string): boolean {
    if (!token) {
      console.warn(`🚫 [Video] validateToken: no token provided videoId=${videoId}`);
      return false;
    }
    const entry = this.tokenStore.get(token);
    if (!entry) {
      console.warn(`🚫 [Video] validateToken: unknown token videoId=${videoId} token=${token.slice(0, 8)}…`);
      return false;
    }

    if (Date.now() > entry.expiresAt) {
      this.tokenStore.delete(token);
      console.warn(`🚫 [Video] validateToken: EXPIRED token videoId=${videoId} token=${token.slice(0, 8)}…`);
      return false;
    }

    if (entry.videoId !== videoId) {
      console.warn(`🚫 [Video] validateToken: token belongs to a different video (expected=${videoId}, actual=${entry.videoId})`);
      return false;
    }
    entry.expiresAt = Date.now() + PLAYBACK_TOKEN_TTL * 1000;
    return true;
  }

  getHlsProgress(videoId: string): number {
    const cached = this.hlsProgressMap.get(videoId);
    const duration = this.hlsDurationMap.get(videoId) || 0;
    const outputDir = path.join(this.hlsBase, videoId);
    let diskPct = 0;

    if (fs.existsSync(outputDir)) {
      try {
        const tsFiles = fs.readdirSync(outputDir).filter(f => f.endsWith('.ts')).length;
        if (tsFiles > 0) {
          if (duration > 0) {
            const expectedChunks = Math.ceil(duration / 15);
            diskPct = Math.round((tsFiles / Math.max(expectedChunks, 1)) * 100);
          } else {
            diskPct = Math.min(tsFiles * 15, 98);
          }
        }
      } catch (e) {}
    }

    const maxProgress = Math.max(cached || 0, diskPct);
    const resultPct = Math.min(Math.max(maxProgress, 1), 99);
    console.log(`📊 [MediaService Debug] HLS Progress for videoId: ${videoId} -> cached: ${cached}%, diskPct: ${diskPct}% => Result: ${resultPct}%`);
    return resultPct;
  }

  async getMasterPlaylist(videoId: string, token?: string) {
    let masterPath = this.safeHlsPath(videoId, 'master.m3u8');
    if (!masterPath || !fs.existsSync(masterPath)) {
      masterPath = this.safeHlsPath(videoId, 'index.m3u8');
    }

    if (!masterPath || !fs.existsSync(masterPath)) {
      console.error(`❌ [Video] master.m3u8 NOT FOUND videoId=${videoId} (checked master.m3u8 and index.m3u8 under ${this.hlsBase}/${videoId})`);
      throw new NotFoundException('HLS Video playlist not found or currently processing');
    }

    console.log(`🎬 [Video] master.m3u8 served videoId=${videoId}`);
    const content = await fs.promises.readFile(masterPath, 'utf8');
    return token ? this.appendPlaybackTokenToPlaylist(content, token) : content;
  }

  getSegmentPath(videoId: string, segment: string): string {
    const segmentPath = this.safeHlsPath(videoId, segment);
    if (!segmentPath || !fs.existsSync(segmentPath)) {
      console.error(`❌ [Video] segment NOT FOUND videoId=${videoId} segment=${segment}`);
      throw new NotFoundException(`Segment chunk ${segment} not found`);
    }
    return segmentPath;
  }

  async getQualityPlaylist(videoId: string, quality: string, token?: string) {
    const playlistPath = this.safeHlsPath(videoId, quality, 'playlist.m3u8') || this.safeHlsPath(videoId, quality, 'index.m3u8');
    if (!playlistPath || !fs.existsSync(playlistPath)) {
      console.error(`❌ [Video] ${quality}/playlist.m3u8 NOT FOUND videoId=${videoId}`);
      throw new NotFoundException(`Quality playlist not found`);
    }

    console.log(`✅ [Video] ${quality}/playlist.m3u8 served videoId=${videoId}`);
    const content = await fs.promises.readFile(playlistPath, 'utf8');
    return token ? this.appendPlaybackTokenToPlaylist(content, token) : content;
  }

  /**
   * Transcodes raw uploaded video file into HLS chunks (.m3u8 + .ts segments)
   * Calculates real-time % progress using ffprobe duration & timemark + disk .ts chunk count!
   */
  async processVideoToHls(
    inputFilePath: string,
    videoId: string,
    onProgress?: (percent: number) => void
  ): Promise<{ streamUrl: string; thumbnailUrl: string }> {
    const outputDir = path.join(this.hlsBase, videoId);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const thumbnailsDir = path.join(this.uploadsDir, 'thumbnails');
    if (!fs.existsSync(thumbnailsDir)) {
      fs.mkdirSync(thumbnailsDir, { recursive: true });
    }

    const playlistPath = path.join(outputDir, 'master.m3u8');
    const thumbnailFileName = `${videoId}.jpg`;
    const thumbnailUrl = `/uploads/thumbnails/${thumbnailFileName}`;

    console.log(`🎬 [HLS Converter] Starting HLS Transcoding for videoId: ${videoId}`);

    // Probe duration for accurate % calculation
    let totalDurationSec = 0;
    try {
      await new Promise<void>((resolve) => {
        ffmpeg.ffprobe(inputFilePath, (err: any, metadata: any) => {
          if (!err && metadata?.format?.duration) {
            totalDurationSec = parseFloat(metadata.format.duration);
            this.hlsDurationMap.set(videoId, totalDurationSec);
            console.log(`⏱️ [HLS Converter Debug] Probed total duration for ${videoId}: ${totalDurationSec}s`);
          }
          resolve();
        });
      });
    } catch (e: any) {
      console.warn(`⚠️ [HLS Converter] FFprobe error:`, e.message);
    }

    // Generate video thumbnail image at 2s timestamp
    try {
      ffmpeg(inputFilePath)
        .screenshots({
          timestamps: ['00:00:02'],
          filename: thumbnailFileName,
          folder: thumbnailsDir,
          size: '640x360',
        })
        .on('end', () => {
          console.log(`🖼️ [HLS Converter] Video thumbnail extracted: ${thumbnailUrl}`);
        })
        .on('error', (err: any) => {
          console.warn(`⚠️ [HLS Converter] Thumbnail extraction skipped:`, err.message);
        });
    } catch (e: any) {
      console.warn(`⚠️ [HLS Converter] Thumbnail error:`, e.message);
    }

    this.hlsProgressMap.set(videoId, 1);

    return new Promise((resolve, reject) => {
      ffmpeg(inputFilePath)
        .outputOptions([
          '-c:v libx264',
          '-pix_fmt yuv420p',
          '-profile:v baseline',
          '-level 3.0',
          '-start_number 0',
          '-hls_time 15',        // 15-second HLS video chunks
          '-hls_list_size 0',
          '-f hls',
          '-preset ultrafast',    // Fast encoding
          '-c:a aac',
          '-b:a 128k',
          '-ar 44100',
          '-ac 2',
        ])
        .output(playlistPath)
        .on('progress', (progress: any) => {
          let pct = 0;
          if (progress.percent && !isNaN(progress.percent) && progress.percent > 0) {
            pct = Math.round(progress.percent);
          } else if (progress.timemark && totalDurationSec > 0) {
            const parts = progress.timemark.split(':');
            if (parts.length === 3) {
              const secs = parseFloat(parts[0]) * 3600 + parseFloat(parts[1]) * 60 + parseFloat(parts[2]);
              pct = Math.round((secs / totalDurationSec) * 100);
            }
          } else if (fs.existsSync(outputDir)) {
            const tsFiles = fs.readdirSync(outputDir).filter(f => f.endsWith('.ts')).length;
            if (totalDurationSec > 0) {
              const expectedChunks = Math.ceil(totalDurationSec / 15);
              pct = Math.round((tsFiles / Math.max(expectedChunks, 1)) * 100);
            } else {
              pct = Math.min(tsFiles * 15, 98);
            }
          }

          const finalPct = Math.min(Math.max(pct, 1), 99);
          this.hlsProgressMap.set(videoId, finalPct);
          console.log(`⏳ [HLS Processing Debug] Video ${videoId} progress: ${finalPct}% (timemark: ${progress?.timemark})`);
          if (onProgress) onProgress(finalPct);
        })
        .on('end', () => {
          console.log(`✅ [HLS Converter] HLS Conversion finished 100% for ${videoId}!`);
          this.hlsProgressMap.set(videoId, 100);
          this.hlsDurationMap.delete(videoId);

          // Delete original raw video file after conversion to save space
          if (fs.existsSync(inputFilePath)) {
            try {
              fs.unlinkSync(inputFilePath);
              console.log(`🗑️ [HLS Converter] Deleted original raw video file: ${inputFilePath}`);
            } catch (err: any) {
              console.warn(`⚠️ [HLS Converter] Failed to delete raw video file:`, err.message);
            }
          }
          resolve({
            streamUrl: `/api/media/stream/${videoId}/master.m3u8`,
            thumbnailUrl,
          });
        })
        .on('error', (err: any) => {
          console.error(`❌ [HLS Converter] FFmpeg conversion error:`, err.message);
          this.hlsProgressMap.delete(videoId);
          this.hlsDurationMap.delete(videoId);
          reject(err);
        })
        .run();
    });
  }

  getFilePath(filename: string): string {
    const safeName = path.basename(filename);
    const filePath = path.join(this.uploadsDir, safeName);
    if (!fs.existsSync(filePath)) {
      throw new NotFoundException('File not found');
    }
    return filePath;
  }
}
