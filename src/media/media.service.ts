import { Injectable, Optional, NotFoundException, ForbiddenException, InternalServerErrorException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { R2Service } from '../r2/r2.service'; // [r2]
import {
  HlsSecurityService,
  ENCRYPTED_SEGMENT_PREFIX,
  ENCRYPTED_PLAY_TOKEN_TTL,
  LEGACY_PLAY_TOKEN_TTL,
  KEY_TOKEN_TTL,
} from './hls-security.service';
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';

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

// Where encrypted segments are fetched from. Defaults to the Node static route registered in
// main.ts; point it at nginx or a CDN (e.g. https://cdn.example.com/hls-seg) to take segment
// traffic off Node entirely.
const SEGMENT_BASE_URL = (process.env.HLS_SEGMENT_BASE_URL || '/hls-seg').replace(/\/$/, '');
const HLS_SEGMENT_SECONDS = 15;

/**
 * Quality ladder. `short` is the short side in px (height for landscape, width for portrait).
 * Only rungs at or below the source are produced — upscaling just wastes storage.
 * CRF keeps simple screen-recording content small; maxrate caps busy scenes.
 */
const QUALITY_LADDER = [
  { name: '360p', short: 360, maxrateK: 700, audioK: 96 },
  { name: '720p', short: 720, maxrateK: 1800, audioK: 128 },
  { name: '1080p', short: 1080, maxrateK: 3500, audioK: 128 },
];
/** Variant (per-quality) playlist links: players may only fetch them when ABR switches later on. */
const VARIANT_TOKEN_TTL = 4 * 60 * 60;
const QUALITY_NAME = /^\d{3,4}p$/;

type Rung = { name: string; scale: string; width: number; height: number; maxrateK: number; audioK: number };

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

@Injectable()
export class MediaService {
  private readonly hlsBase = path.join(process.cwd(), 'uploads', 'hls');
  private readonly uploadsDir = path.join(process.cwd(), 'uploads');
  private hlsProgressMap = new Map<string, number>();
  private hlsDurationMap = new Map<string, number>();
  private hlsRungCountMap = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly hlsSecurity: HlsSecurityService,
    @Optional() private readonly r2?: R2Service, // [r2]
  ) {}

  /**
   * Where this video's encrypted chunks are fetched from. [r2] Once all of them are in the bucket
   * and R2 has a public domain, straight from Cloudflare; otherwise the /hls-seg static route.
   */
  private async segmentBase(videoId: string): Promise<string> {
    return (await this.r2?.hlsPublicBase(videoId, this.hlsBase)) || SEGMENT_BASE_URL;
  }

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

  async issueToken(videoId: string, userId: number) {
    if (!(await this.hlsSecurity.canAccess(userId, videoId))) {
      throw new ForbiddenException('You do not have access to this video');
    }
    const encrypted = this.hlsSecurity.isEncrypted(videoId);
    const ttl = encrypted ? ENCRYPTED_PLAY_TOKEN_TTL : LEGACY_PLAY_TOKEN_TTL;
    const token = this.hlsSecurity.sign('hls-play', userId, videoId, ttl);
    console.log(`🎫 [Video] Token issued videoId=${videoId} user=${userId} encrypted=${encrypted}`);

    // Manual quality picker (mobile app): direct links to each quality's playlist.
    const qualities = await this.listQualities(videoId);
    const variantToken = qualities.length ? this.hlsSecurity.sign('hls-play', userId, videoId, VARIANT_TOKEN_TTL) : '';
    const resolutions = qualities.map((q) => ({ label: q, url: this.variantUrl(videoId, q, variantToken) }));

    return {
      success: true,
      token,
      expiresIn: ttl,
      encrypted,
      streamUrl: `/api/media/stream/${videoId}/master.m3u8?token=${encodeURIComponent(token)}`,
      resolutions,
    };
  }

  /** User id the playback token belongs to, or null. Stateless — survives restarts, never slides. */
  validateToken(token: string, videoId: string): number | null {
    const userId = this.hlsSecurity.verify('hls-play', token, videoId);
    if (!userId) console.warn(`🚫 [Video] validateToken: invalid/expired token videoId=${videoId}`);
    return userId;
  }

  /**
   * Encrypted playlist for one viewer: segment lines point at the static segment host (no token),
   * and the key line gets a short-lived key token bound to this user + video.
   */
  private rewriteEncryptedPlaylist(content: string, videoId: string, userId: number, segBase: string, quality?: string): string {
    const keyToken = this.hlsSecurity.sign('hls-key', userId, videoId, KEY_TOKEN_TTL);
    const keyUri = `/api/media/key/${videoId}?kt=${encodeURIComponent(keyToken)}`;
    const segDir = quality ? `${segBase}/${videoId}/${quality}` : `${segBase}/${videoId}`;
    return content
      .split(/\r?\n/)
      .map((line) => {
        const trimmed = line.trim();
        if (trimmed.startsWith('#EXT-X-KEY')) {
          return line.replace(/URI="[^"]*"/, `URI="${keyUri}"`);
        }
        if (!trimmed || trimmed.startsWith('#')) return line;
        return `${segDir}/${path.basename(trimmed.split('?')[0])}`;
      })
      .join('\n');
  }

  /**
   * Multi-quality master: each quality link gets its own longer-lived play token, because a player
   * may only fetch a quality's playlist when ABR switches to it 30+ minutes into the video. That
   * link only yields public encrypted segment URLs and a fresh 10-minute key token — the key itself
   * is still enrollment-checked and rate-limited on every fetch.
   */
  private rewriteMasterPlaylist(content: string, videoId: string, userId: number): string {
    const variantToken = this.hlsSecurity.sign('hls-play', userId, videoId, VARIANT_TOKEN_TTL);
    return content
      .split(/\r?\n/)
      .map((line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) return line;
        const quality = trimmed.split('/')[0];
        return QUALITY_NAME.test(quality) ? this.variantUrl(videoId, quality, variantToken) : line;
      })
      .join('\n');
  }

  private async renderPlaylist(content: string, videoId: string, viewer: { token?: string; userId?: number }, quality?: string) {
    if (this.hlsSecurity.isEncrypted(videoId)) {
      if (!viewer.userId) throw new ForbiddenException('Missing or expired playback token');
      if (this.isMasterPlaylist(content)) return this.rewriteMasterPlaylist(content, videoId, viewer.userId);
      return this.rewriteEncryptedPlaylist(content, videoId, viewer.userId, await this.segmentBase(videoId), quality);
    }
    return viewer.token ? this.appendPlaybackTokenToPlaylist(content, viewer.token) : content;
  }

  /** The AES key, after re-checking the key token, access and rate limit. */
  async getKey(videoId: string, keyToken: string | undefined, headerUserId?: number | null): Promise<Buffer> {
    const userId = this.hlsSecurity.verify('hls-key', keyToken, videoId) ?? headerUserId ?? null;
    if (!userId) throw new ForbiddenException('Key link expired');
    if (!(await this.hlsSecurity.canAccess(userId, videoId))) {
      throw new ForbiddenException('You do not have access to this video');
    }
    this.hlsSecurity.assertKeyRate(userId, videoId);
    return this.hlsSecurity.readKey(videoId);
  }

  isEncrypted(videoId: string): boolean {
    return this.hlsSecurity.isEncrypted(videoId);
  }

  canAccess(userId: number, videoId: string): Promise<boolean> {
    return this.hlsSecurity.canAccess(userId, videoId);
  }

  deleteHlsKey(videoId: string) {
    this.hlsSecurity.deleteKey(videoId);
  }

  getHlsProgress(videoId: string): number {
    const cached = this.hlsProgressMap.get(videoId);
    const duration = this.hlsDurationMap.get(videoId) || 0;
    const outputDir = path.join(this.hlsBase, videoId);
    let diskPct = 0;

    if (fs.existsSync(outputDir)) {
      try {
        const tsFiles = this.countSegments(outputDir);
        if (tsFiles > 0) {
          if (duration > 0) {
            const expectedChunks = Math.ceil(duration / 15) * (this.hlsRungCountMap.get(videoId) || 1);
            diskPct = Math.round((tsFiles / Math.max(expectedChunks, 1)) * 100);
          } else {
            diskPct = Math.min(tsFiles * 15, 98);
          }
        }
      } catch (e) {}
    }

    const maxProgress = Math.max(cached || 0, diskPct);
    // Finished conversions report 100 (the old 99 cap kept cards stuck on "converting").
    const resultPct = cached === 100 ? 100 : Math.min(Math.max(maxProgress, 1), 99);
    console.log(`📊 [MediaService Debug] HLS Progress for videoId: ${videoId} -> cached: ${cached}%, diskPct: ${diskPct}% => Result: ${resultPct}%`);
    return resultPct;
  }

  async getMasterPlaylist(videoId: string, viewer: { token?: string; userId?: number } = {}) {
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
    return this.renderPlaylist(content, videoId, viewer);
  }

  /**
   * True when a video's conversion has finished on disk (master.m3u8 is written last, after every
   * quality is done) and it is not currently being converted by this process.
   */
  isHlsReady(videoId: string): boolean {
    const pct = this.hlsProgressMap.get(videoId);
    if (pct !== undefined && pct < 100) return false;
    const master = this.safeHlsPath(videoId, 'master.m3u8');
    return !!master && fs.existsSync(master);
  }

  /** .ts chunks in a video folder, including per-quality subfolders. */
  private countSegments(dir: string): number {
    let n = 0;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) n += this.countSegments(path.join(dir, entry.name));
      else if (entry.name.endsWith('.ts')) n++;
    }
    return n;
  }

  /** Chunk of one quality (only used for unencrypted videos; encrypted ones go through /hls-seg). */
  getQualitySegmentPath(videoId: string, quality: string, segment: string): string {
    if (!QUALITY_NAME.test(quality) || !segment.endsWith('.ts')) throw new NotFoundException('Segment not found');
    const segmentPath = this.safeHlsPath(videoId, quality, segment);
    if (!segmentPath || !fs.existsSync(segmentPath)) throw new NotFoundException(`Segment chunk ${segment} not found`);
    return segmentPath;
  }

  getSegmentPath(videoId: string, segment: string): string {
    const segmentPath = this.safeHlsPath(videoId, segment);
    if (!segmentPath || !fs.existsSync(segmentPath)) {
      console.error(`❌ [Video] segment NOT FOUND videoId=${videoId} segment=${segment}`);
      throw new NotFoundException(`Segment chunk ${segment} not found`);
    }
    return segmentPath;
  }

  async getQualityPlaylist(videoId: string, quality: string, viewer: { token?: string; userId?: number } = {}) {
    if (!QUALITY_NAME.test(quality)) throw new NotFoundException('Quality playlist not found');
    const playlistPath = [this.safeHlsPath(videoId, quality, 'playlist.m3u8'), this.safeHlsPath(videoId, quality, 'index.m3u8')].find(
      (p) => p && fs.existsSync(p),
    );
    if (!playlistPath) {
      console.error(`❌ [Video] ${quality}/playlist.m3u8 NOT FOUND videoId=${videoId}`);
      throw new NotFoundException(`Quality playlist not found`);
    }

    console.log(`✅ [Video] ${quality}/playlist.m3u8 served videoId=${videoId}`);
    const content = await fs.promises.readFile(playlistPath, 'utf8');
    return this.renderPlaylist(content, videoId, viewer, quality);
  }

  /**
   * Queues a video for HLS conversion. Only ONE ffmpeg runs at a time — it uses every CPU core,
   * so parallel conversions would starve the site for students. Others wait in line (their card
   * stays at "converting 1%" until their turn). The queue is in memory.
   */
  processVideoToHls(
    inputFilePath: string,
    videoId: string,
    onProgress?: (percent: number) => void
  ): Promise<{ streamUrl: string; thumbnailUrl: string }> {
    const waiting = this.hlsQueueLength++;
    if (waiting > 0) console.log(`⏳ [HLS Queue] ${videoId} queued — ${waiting} conversion(s) ahead`);
    const run = () => {
      this.hlsQueueLength--;
      // Deleted from the library while waiting — nothing to convert.
      if (!fs.existsSync(inputFilePath)) return Promise.reject(new Error('Source video was deleted before conversion started'));
      return this.runHlsConversion(inputFilePath, videoId, onProgress);
    };
    const job = this.hlsQueue.then(run, run);
    this.hlsQueue = job.catch(() => {});
    return job;
  }

  private hlsQueue: Promise<unknown> = Promise.resolve();
  private hlsQueueLength = 0;

  /**
   * Transcodes raw uploaded video file into HLS chunks (.m3u8 + .ts segments)
   * Calculates real-time % progress using ffprobe duration & timemark + disk .ts chunk count!
   */
  private async runHlsConversion(
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

    // Probe duration (for accurate %), resolution (quality ladder), audio and bitrate
    let totalDurationSec = 0;
    let srcWidth = 0;
    let srcHeight = 0;
    let hasAudio = true;
    let srcBitrateK = 0;
    try {
      const info = await this.probeSource(inputFilePath);
      ({ width: srcWidth, height: srcHeight, hasAudio, bitrateK: srcBitrateK } = info);
      if (info.durationSec > 0) {
        totalDurationSec = info.durationSec;
        this.hlsDurationMap.set(videoId, totalDurationSec);
        console.log(`⏱️ [HLS Converter Debug] Probed total duration for ${videoId}: ${totalDurationSec}s`);
      }
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

    // AES-128 encryption is on by default; HLS_ENCRYPTION=false falls back to plain segments.
    // One key per video, shared by all qualities (players fetch it once, even when switching).
    const encrypt = process.env.HLS_ENCRYPTION !== 'false';
    const keyInfoPath = encrypt ? this.hlsSecurity.ensureKey(videoId).keyInfoPath : null;
    const segPrefix = encrypt ? ENCRYPTED_SEGMENT_PREFIX : 'seg_';

    const rungs = this.pickRungs(srcWidth, srcHeight, srcBitrateK);
    this.hlsRungCountMap.set(videoId, rungs.length);
    console.log(`🎚️ [HLS Converter] ${videoId} source=${srcWidth}x${srcHeight} ${srcBitrateK}k → ${rungs.map((r) => r.name).join(', ')}`);

    // One decode, N encodes: split the video once and write every quality in a single ffmpeg run.
    // (Separate outputs instead of -var_stream_map: the bundled 2018 ffmpeg crashes writing an
    // encrypted multi-variant master, so master.m3u8 is written by us after encoding.)
    const filter =
      `[0:v]split=${rungs.length}${rungs.map((_, i) => `[s${i}]`).join('')};` +
      rungs.map((r, i) => `[s${i}]scale=${r.scale}[v${i}]`).join(';');

    let command = ffmpeg(inputFilePath).complexFilter(filter);
    for (const [i, r] of rungs.entries()) {
      const dir = path.join(outputDir, r.name);
      fs.mkdirSync(dir, { recursive: true });
      // Flag and value as separate items: fluent-ffmpeg only splits "flag value" strings that
      // contain exactly one space, so a path with spaces would otherwise reach ffmpeg mangled.
      command = command.output(path.join(dir, 'playlist.m3u8')).outputOptions([
        '-map', `[v${i}]`,
        ...(hasAudio ? ['-map', '0:a:0', '-c:a', 'aac', '-b:a', `${r.audioK}k`, '-ar', '44100', '-ac', '2'] : []),
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-profile:v', 'main',
        '-pix_fmt', 'yuv420p',
        '-crf', '23',
        '-maxrate', `${r.maxrateK}k`,
        '-bufsize', `${r.maxrateK * 2}k`,
        // Keyframe exactly at every segment boundary: even 15s chunks, aligned across qualities
        // so switching quality mid-video is seamless.
        '-sc_threshold', '0',
        '-force_key_frames', `expr:gte(t,n_forced*${HLS_SEGMENT_SECONDS})`,
        '-f', 'hls',
        '-hls_time', String(HLS_SEGMENT_SECONDS),
        '-hls_list_size', '0',
        '-hls_playlist_type', 'vod',
        '-start_number', '0',
        ...(keyInfoPath ? ['-hls_key_info_file', keyInfoPath] : []),
        '-hls_segment_filename', path.join(dir, `${segPrefix}%05d.ts`),
      ]);
    }

    return new Promise((resolve, reject) => {
      command
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
            const tsFiles = this.countSegments(outputDir);
            if (totalDurationSec > 0) {
              const expectedChunks = Math.ceil(totalDurationSec / 15) * rungs.length;
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
          try {
            fs.writeFileSync(playlistPath, this.buildMasterPlaylist(rungs));
          } catch (err: any) {
            console.error(`❌ [HLS Converter] Failed to write master playlist:`, err.message);
            this.hlsProgressMap.delete(videoId);
            return reject(err);
          }
          console.log(`✅ [HLS Converter] HLS Conversion finished 100% for ${videoId}!`);
          this.hlsProgressMap.set(videoId, 100);
          this.hlsDurationMap.delete(videoId);
          this.hlsRungCountMap.delete(videoId);

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
          this.hlsRungCountMap.delete(videoId);
          reject(err);
        })
        .run();
    });
  }

  /**
   * Source info via `ffmpeg -i` (only the ffmpeg binary ships with @ffmpeg-installer — there is no
   * ffprobe, so fluent-ffmpeg's ffprobe() always failed). Width/height account for phone rotation.
   */
  private probeSource(file: string): Promise<{ durationSec: number; width: number; height: number; hasAudio: boolean; bitrateK: number }> {
    return new Promise((resolve) => {
      const proc = spawn(ffmpegInstaller.path, ['-hide_banner', '-i', file]);
      let err = '';
      proc.stderr.on('data', (d: Buffer) => (err += d.toString()));
      const done = () => {
        const dur = err.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
        const durationSec = dur ? +dur[1] * 3600 + +dur[2] * 60 + parseFloat(dur[3]) : 0;
        const bitrateK = Number(err.match(/bitrate:\s*(\d+)\s*kb\/s/)?.[1]) || 0;
        const videoLine = err.split('\n').find((l) => /Stream #.*Video:/.test(l)) || '';
        const size = videoLine.match(/\b(\d{2,5})x(\d{2,5})\b/);
        let width = size ? +size[1] : 0;
        let height = size ? +size[2] : 0;
        const rotate = Math.abs(Number(err.match(/rotate\s*:\s*(-?\d+)/)?.[1]) || 0);
        if (rotate === 90 || rotate === 270) [width, height] = [height, width];
        resolve({ durationSec, width, height, hasAudio: /Stream #.*Audio:/.test(err), bitrateK });
      };
      proc.on('close', done);
      proc.on('error', done);
    });
  }

  /** Ladder rungs for this source: no upscaling, portrait-aware, bitrate never above the source. */
  private pickRungs(srcW: number, srcH: number, srcBitrateK: number): Rung[] {
    const portrait = srcH > srcW && srcW > 0;
    const srcShort = srcW && srcH ? Math.min(srcW, srcH) : 0;
    const ratio = srcW && srcH ? Math.max(srcW, srcH) / Math.min(srcW, srcH) : 16 / 9;

    // Unknown source size: 360p + 720p is the safe default.
    let ladder = srcShort ? QUALITY_LADDER.filter((q) => q.short <= srcShort) : QUALITY_LADDER.slice(0, 2);
    // Tiny source (< 360p): one rung at the source's own size.
    if (!ladder.length) ladder = [{ ...QUALITY_LADDER[0], short: even(srcShort) }];

    return ladder.map((q) => {
      const long = even(q.short * ratio);
      const width = portrait ? q.short : long;
      const height = portrait ? long : q.short;
      // A source already at 2 Mbps gains nothing from a 3.5 Mbps cap — keep it at ~source rate.
      const maxrateK = srcBitrateK > 0 ? Math.max(300, Math.min(q.maxrateK, Math.round(srcBitrateK * 1.1))) : q.maxrateK;
      return {
        name: q.name,
        scale: portrait ? `${q.short}:-2` : `-2:${q.short}`,
        width,
        height,
        maxrateK,
        audioK: q.audioK,
      };
    });
  }

  /** Master playlist. 720p is listed first so playback starts at a sensible quality, then ABR adapts. */
  private buildMasterPlaylist(rungs: Rung[]): string {
    const ordered = [...rungs].sort((a, b) => (a.name === '720p' ? -1 : b.name === '720p' ? 1 : a.height - b.height));
    const lines = ['#EXTM3U', '#EXT-X-VERSION:3'];
    for (const r of ordered) {
      const bandwidth = (r.maxrateK + r.audioK) * 1000;
      lines.push(`#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},RESOLUTION=${r.width}x${r.height},NAME="${r.name}"`);
      lines.push(`${r.name}/playlist.m3u8`);
    }
    return lines.join('\n') + '\n';
  }

  private isMasterPlaylist(content: string): boolean {
    return content.includes('#EXT-X-STREAM-INF');
  }

  /** Qualities listed in a video's master playlist (lowest first), for the app's quality picker. */
  private async listQualities(videoId: string): Promise<string[]> {
    const masterPath = this.safeHlsPath(videoId, 'master.m3u8');
    if (!masterPath || !fs.existsSync(masterPath)) return [];
    const content = await fs.promises.readFile(masterPath, 'utf8');
    if (!this.isMasterPlaylist(content)) return [];
    return content
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'))
      .map((l) => l.split('/')[0])
      .filter((q) => QUALITY_NAME.test(q))
      .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
  }

  private variantUrl(videoId: string, quality: string, token: string): string {
    return `/api/media/stream/${videoId}/${quality}/playlist.m3u8?token=${encodeURIComponent(token)}`;
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
