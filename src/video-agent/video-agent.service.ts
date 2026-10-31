import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import type { Socket } from 'socket.io';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { HlsSecurityService } from '../media/hls-security.service';
import { R2Service } from '../r2/r2.service';
import { RealtimeService } from '../realtime/realtime.service';

/**
 * Windows Local Video Processing Agent (local_agent/) — server side.
 *
 *   browser ──(MP4, localhost)──▶ agent ──ffmpeg──▶ encrypted HLS ──(presigned PUT)──▶ R2
 *      │                             │
 *      └── POST /video-agent/jobs    └── socket /video-agent: key, presign, progress
 *                                    └── POST …/finalize: playlists + thumbnail (text/KBs only)
 *
 * This server never sees a video byte: it pairs the agent, hands out the per-video AES key
 * (which stays in storage/hls_keys like VPS-converted videos), signs upload URLs, verifies the
 * bucket and writes the playlists to uploads/hls/<videoId>/ so the existing player, key and
 * /hls-seg routes serve the video unchanged. When the agent is offline the browser falls back
 * to the old /upload/chunk + VPS ffmpeg path (utils/upload.js).
 */

export const VIDEO_JOB_EVENT = 'video_job';
export const AGENT_LOCAL_PORT = 47800;

const PAIRING_CODE_TTL_MS = 10 * 60 * 1000;
const STALE_RECEIVE_MS = 24 * 60 * 60 * 1000;
const ACTIVE_STATUSES = ['queued', 'receiving', 'transcoding', 'uploading', 'verifying', 'failed'];
const JOB_STATUSES = new Set(['queued', 'receiving', 'transcoding', 'uploading', 'verifying', 'failed']);
const PLAYLIST_PATH = /^(master\.m3u8|\d{3,4}p\/playlist\.m3u8)$/;
const SEGMENT_PATH = /^\d{3,4}p\/enc_\d{5}\.ts$/;

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

export interface FinalizeDto {
  playlists: Record<string, string>;
  segments: Record<string, number>;
  thumbnail?: string; // base64 jpeg
  durationSec?: number;
}

@Injectable()
export class VideoAgentService {
  private readonly logger = new Logger('VideoAgent');
  private readonly hlsBase = path.join(process.cwd(), 'uploads', 'hls');
  private readonly thumbsDir = path.join(process.cwd(), 'uploads', 'thumbnails');
  private pairing: { codeHash: string; expiresAt: number; createdById?: string } | null = null;
  private sockets = new Map<string, Socket>(); // agentId → socket

  constructor(
    private readonly prisma: PrismaService,
    private readonly hlsSecurity: HlsSecurityService,
    private readonly r2: R2Service,
    private readonly realtime: RealtimeService,
  ) {}

  // ─── Pairing ─────────────────────────────────────────────────────────────

  createPairingCode(userId?: string) {
    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    this.pairing = { codeHash: sha256(code), expiresAt: Date.now() + PAIRING_CODE_TTL_MS, createdById: userId };
    return { code, expiresAt: new Date(this.pairing.expiresAt).toISOString() };
  }

  /** One agent per install: pairing a new PC revokes the previous one. */
  async pair(code: string, name: string, version?: string) {
    const p = this.pairing;
    if (!p || Date.now() > p.expiresAt || !code || sha256(String(code).trim()) !== p.codeHash) {
      throw new ForbiddenException('Pairing code is invalid or expired');
    }
    this.pairing = null;
    const token = crypto.randomBytes(32).toString('base64url');
    await this.prisma.videoAgent.updateMany({ where: { revokedAt: null }, data: { revokedAt: new Date() } });
    const agent = await this.prisma.videoAgent.create({
      data: { name: String(name || 'Windows PC').slice(0, 80), tokenHash: sha256(token), version, createdById: p.createdById },
    });
    for (const [id, s] of this.sockets) if (id !== agent.id) s.disconnect(true);
    this.logger.log(`Agent paired: ${agent.name} (${agent.id})`);
    return { token, agentId: agent.id };
  }

  async revoke() {
    await this.prisma.videoAgent.updateMany({ where: { revokedAt: null }, data: { revokedAt: new Date() } });
    for (const s of this.sockets.values()) s.disconnect(true);
    this.sockets.clear();
    return { success: true };
  }

  async authenticate(token?: string) {
    if (!token) return null;
    const agent = await this.prisma.videoAgent.findUnique({ where: { tokenHash: sha256(token) } });
    return agent && !agent.revokedAt ? agent : null;
  }

  // ─── Socket presence (video-agent.gateway.ts) ────────────────────────────

  async attach(agentId: string, socket: Socket, info: { encoder?: string; version?: string }) {
    this.sockets.get(agentId)?.disconnect(true);
    this.sockets.set(agentId, socket);
    await this.prisma.videoAgent.update({
      where: { id: agentId },
      data: { lastSeenAt: new Date(), encoder: info.encoder || undefined, version: info.version || undefined },
    });
  }

  detach(agentId: string, socket: Socket) {
    if (this.sockets.get(agentId) === socket) this.sockets.delete(agentId);
    this.prisma.videoAgent.update({ where: { id: agentId }, data: { lastSeenAt: new Date() } }).catch(() => {});
  }

  private emitToAgent(agentId: string, event: string, data: any) {
    this.sockets.get(agentId)?.emit(event, data);
  }

  async status() {
    const agent = await this.prisma.videoAgent.findFirst({ where: { revokedAt: null }, orderBy: { createdAt: 'desc' } });
    return {
      paired: !!agent,
      online: !!agent && this.sockets.has(agent.id),
      r2Ready: await this.r2.canAcceptAgentUploads(),
      localPort: AGENT_LOCAL_PORT,
      agent: agent && { id: agent.id, name: agent.name, encoder: agent.encoder, version: agent.version, lastSeenAt: agent.lastSeenAt },
    };
  }

  // ─── Jobs (dashboard side) ───────────────────────────────────────────────

  /**
   * Creates the Media row + job and tells the agent to expect the file. Throws 409 when the
   * agent can't take it — the browser then falls back to the VPS upload.
   */
  async createJob(
    dto: { agentId?: string; fileName?: string; fileSize?: number; title?: string; courseId?: string },
    userId?: string,
  ) {
    const fileName = String(dto.fileName || '').trim();
    if (!fileName || !/\.(mp4|mkv|mov|avi|webm|m4v)$/i.test(fileName)) throw new BadRequestException('A video file is required');
    const agent = await this.prisma.videoAgent.findFirst({ where: { revokedAt: null }, orderBy: { createdAt: 'desc' } });
    if (!agent || !this.sockets.has(agent.id)) throw new ConflictException('Local agent is offline');
    if (dto.agentId && dto.agentId !== agent.id) throw new ConflictException('This PC runs an agent paired with another server');
    if (!(await this.r2.canAcceptAgentUploads())) throw new ConflictException('Cloudflare R2 is not configured');

    const videoId = `video_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const uploadSecret = crypto.randomBytes(24).toString('base64url');
    // The folder marks the row as an HLS video for the library listing (uploads.service findAll).
    fs.mkdirSync(path.join(this.hlsBase, videoId), { recursive: true });

    const media = await this.prisma.media.create({
      data: {
        name: dto.title || fileName,
        url: `/api/media/stream/${videoId}/master.m3u8`,
        type: 'video',
        format: 'm3u8',
        status: 'uploading',
        size: BigInt(Math.max(0, Number(dto.fileSize) || 0)),
        uploadedById: userId != null ? String(userId) : null,
        courseId: dto.courseId ? String(dto.courseId) : null,
        videoId,
        processingProgress: 1,
      },
    });
    const job = await this.prisma.videoJob.create({
      data: {
        agentId: agent.id,
        mediaId: media.id,
        videoId,
        fileName,
        fileSize: BigInt(Math.max(0, Number(dto.fileSize) || 0)),
        uploadSecret,
        createdById: userId != null ? String(userId) : null,
      },
    });
    await this.prisma.media.update({ where: { id: media.id }, data: { jobId: job.id } });
    this.emitToAgent(agent.id, 'job:new', this.agentView(job));
    this.logger.log(`Job ${job.id} → agent ${agent.name} (${fileName})`);

    return {
      success: true,
      jobId: job.id,
      uploadSecret,
      videoId,
      id: media.id,
      url: media.url,
      localPort: AGENT_LOCAL_PORT,
    };
  }

  async listJobs(limit = 30) {
    const jobs = await this.prisma.videoJob.findMany({ orderBy: { createdAt: 'desc' }, take: Math.min(100, Math.max(1, limit)) });
    return jobs.map((j) => this.publicView(j));
  }

  async retryJob(id: string) {
    const job = await this.prisma.videoJob.findUnique({ where: { id } });
    if (!job) throw new NotFoundException('Job not found');
    if (job.status !== 'failed') throw new BadRequestException('Only failed jobs can be retried');
    if (!this.sockets.has(job.agentId)) throw new ConflictException('Local agent is offline');
    this.emitToAgent(job.agentId, 'job:retry', { jobId: job.id });
    return { success: true };
  }

  /**
   * `discard` (browser couldn't hand the file to the agent and is falling back to the VPS
   * upload): also removes the Media row, which never had any content yet.
   */
  async cancelJob(id: string, discard = false) {
    const job = await this.prisma.videoJob.findUnique({ where: { id } });
    if (!job) throw new NotFoundException('Job not found');
    const neverReceived = job.status === 'queued' || job.status === 'receiving';
    await this.markCancelled(job);
    if (discard && neverReceived) {
      await this.prisma.media.deleteMany({ where: { id: job.mediaId, status: { not: 'ready' } } });
      fs.rmSync(path.join(this.hlsBase, job.videoId), { recursive: true, force: true });
      this.hlsSecurity.deleteKey(job.videoId);
    }
    return { success: true };
  }

  /** Called when a Media row is deleted from the library while its job is still running. */
  async cancelForVideo(videoId?: string | null) {
    if (!videoId) return;
    const job = await this.prisma.videoJob.findUnique({ where: { videoId } });
    if (job && ACTIVE_STATUSES.includes(job.status)) await this.markCancelled(job);
  }

  private async markCancelled(job: { id: string; agentId: string; videoId: string; status: string }) {
    if (job.status === 'completed' || job.status === 'cancelled') return;
    await this.prisma.videoJob.update({ where: { id: job.id }, data: { status: 'cancelled' } });
    this.emitToAgent(job.agentId, 'job:cancel', { jobId: job.id });
    await this.prisma.media.updateMany({ where: { videoId: job.videoId, status: { not: 'ready' } }, data: { status: 'failed', failureReason: 'Cancelled' } });
    this.r2.deleteHlsSegments(job.videoId).catch(() => {});
  }

  // ─── Jobs (agent side, over the socket) ──────────────────────────────────

  /** Jobs the agent should still hold — it resumes these after a restart or reconnect. */
  async pendingFor(agentId: string) {
    const jobs = await this.prisma.videoJob.findMany({ where: { agentId, status: { in: ACTIVE_STATUSES } } });
    return jobs.map((j) => this.agentView(j));
  }

  private async ownJob(agentId: string, jobId: string) {
    const job = await this.prisma.videoJob.findUnique({ where: { id: String(jobId || '') } });
    if (!job || job.agentId !== agentId) throw new ForbiddenException('Unknown job');
    if (job.status === 'cancelled' || job.status === 'completed') throw new ConflictException(`Job is ${job.status}`);
    return job;
  }

  /** The AES-128 key the agent encrypts this video's segments with. Created on first ask. */
  async keyFor(agentId: string, jobId: string) {
    const job = await this.ownJob(agentId, jobId);
    return { key: this.hlsSecurity.ensureKeyBytes(job.videoId).toString('base64') };
  }

  async presign(agentId: string, jobId: string, paths: string[]) {
    const job = await this.ownJob(agentId, jobId);
    const clean = (Array.isArray(paths) ? paths : []).map(String);
    if (!clean.length || clean.length > 500 || clean.some((p) => !SEGMENT_PATH.test(p))) {
      throw new BadRequestException('Invalid segment paths');
    }
    return { urls: await this.r2.presignHlsPuts(job.videoId, clean) };
  }

  async reportStatus(
    agentId: string,
    p: { jobId: string; status: string; progress?: number; encoder?: string; rungs?: string; uploadedBytes?: number; segmentCount?: number; error?: string },
  ) {
    const job = await this.ownJob(agentId, p.jobId);
    if (!JOB_STATUSES.has(p.status)) throw new BadRequestException('Invalid status');
    const progress = Math.max(0, Math.min(99, Math.round(Number(p.progress) || 0)));
    const failed = p.status === 'failed';
    const updated = await this.prisma.videoJob.update({
      where: { id: job.id },
      data: {
        status: p.status,
        progress,
        encoder: p.encoder ?? undefined,
        rungs: p.rungs ?? undefined,
        segmentCount: p.segmentCount ?? undefined,
        uploadedBytes: p.uploadedBytes != null ? BigInt(Math.max(0, Math.round(p.uploadedBytes))) : undefined,
        error: failed ? String(p.error || 'Processing failed').slice(0, 500) : null,
        startedAt: job.startedAt ?? (p.status === 'transcoding' ? new Date() : undefined),
        attempts: p.status === 'transcoding' && job.status !== 'transcoding' ? { increment: 1 } : undefined,
      },
    });
    await this.prisma.media.updateMany({
      where: { videoId: job.videoId },
      data: failed
        ? { status: 'failed', failureReason: String(p.error || 'Processing failed').slice(0, 250) }
        : { status: p.status === 'receiving' ? 'uploading' : 'processing', processingProgress: Math.max(1, progress), failureReason: null },
    });
    this.broadcast(updated);
    return { ok: true };
  }

  /**
   * Last step: verify every segment the playlists reference is in the bucket with the size the
   * agent uploaded, then publish the playlists here. Only after this returns ok may the agent
   * delete its source MP4.
   */
  async finalize(agentId: string, jobId: string, dto: FinalizeDto) {
    const job = await this.ownJob(agentId, jobId);
    const media = await this.prisma.media.findUnique({ where: { id: job.mediaId } });
    if (!media) {
      await this.markCancelled(job);
      throw new ConflictException('The video was deleted from the library');
    }
    await this.prisma.videoJob.update({ where: { id: job.id }, data: { status: 'verifying', progress: 99 } });

    const playlists = dto?.playlists || {};
    const names = Object.keys(playlists);
    if (!playlists['master.m3u8'] || names.some((n) => !PLAYLIST_PATH.test(n))) throw new BadRequestException('Invalid playlists');

    const expected = new Set<string>();
    for (const name of names.filter((n) => n !== 'master.m3u8')) {
      const quality = name.split('/')[0];
      const body = String(playlists[name]);
      // Unencrypted segments would be playable straight from the bucket — never publish them.
      if (!/#EXT-X-KEY:METHOD=AES-128/.test(body)) throw new BadRequestException(`${name} is not encrypted`);
      for (const line of body.split(/\r?\n/).map((l) => l.trim())) {
        if (!line || line.startsWith('#')) continue;
        const seg = `${quality}/${path.basename(line)}`;
        if (!SEGMENT_PATH.test(seg)) throw new BadRequestException(`Unexpected playlist entry ${line}`);
        expected.add(seg);
      }
    }
    if (!expected.size) throw new BadRequestException('Playlists list no segments');

    const inBucket = await this.r2.listHlsObjects(job.videoId);
    const missing = [...expected].filter((seg) => {
      const size = inBucket.get(seg);
      return size == null || size === 0 || (dto.segments?.[seg] != null && Number(dto.segments[seg]) !== size);
    });
    if (missing.length) {
      await this.prisma.videoJob.update({ where: { id: job.id }, data: { status: 'uploading' } });
      return { ok: false, missing };
    }

    // Publish: variant playlists first, master last (master on disk = "ready" everywhere else).
    const dir = path.join(this.hlsBase, job.videoId);
    for (const name of names.filter((n) => n !== 'master.m3u8')) {
      fs.mkdirSync(path.join(dir, name.split('/')[0]), { recursive: true });
      fs.writeFileSync(path.join(dir, name), String(playlists[name]));
    }
    fs.writeFileSync(path.join(dir, 'master.m3u8'), String(playlists['master.m3u8']));

    let thumbnailUrl: string | undefined;
    if (dto.thumbnail) {
      const buf = Buffer.from(dto.thumbnail, 'base64');
      if (buf.length > 0 && buf.length < 2 * 1024 * 1024 && buf[0] === 0xff && buf[1] === 0xd8) {
        fs.mkdirSync(this.thumbsDir, { recursive: true });
        fs.writeFileSync(path.join(this.thumbsDir, `${job.videoId}.jpg`), buf);
        thumbnailUrl = `/uploads/thumbnails/${job.videoId}.jpg`;
      }
    }

    const totalBytes = [...expected].reduce((n, seg) => n + (inBucket.get(seg) || 0), 0);
    await this.prisma.media.update({
      where: { id: media.id },
      data: {
        status: 'ready',
        format: 'm3u8',
        url: `/api/media/stream/${job.videoId}/master.m3u8`,
        masterPlaylistUrl: `/api/media/stream/${job.videoId}/master.m3u8`,
        hlsKeyId: job.videoId,
        thumbnailUrl: thumbnailUrl ?? media.thumbnailUrl,
        duration: Number(dto.durationSec) > 0 ? Number(dto.durationSec) : media.duration,
        processingProgress: 100,
        failureReason: null,
      },
    });
    const done = await this.prisma.videoJob.update({
      where: { id: job.id },
      data: { status: 'completed', progress: 100, segmentCount: expected.size, uploadedBytes: BigInt(totalBytes), error: null, completedAt: new Date() },
    });
    this.broadcast(done);
    this.logger.log(`Job ${job.id} completed — ${expected.size} segments, ${(totalBytes / 1048576).toFixed(1)} MB in R2`);
    return { ok: true };
  }

  // ─── Housekeeping ────────────────────────────────────────────────────────

  /** A browser that never finished handing the file over leaves a job stuck — fail it after a day. */
  @Interval(60 * 60 * 1000)
  async failStaleJobs() {
    const cutoff = new Date(Date.now() - STALE_RECEIVE_MS);
    const stale = await this.prisma.videoJob.findMany({ where: { status: { in: ['queued', 'receiving'] }, updatedAt: { lt: cutoff } } });
    for (const job of stale) {
      await this.prisma.videoJob.update({ where: { id: job.id }, data: { status: 'failed', error: 'The file never reached the local agent' } });
      await this.prisma.media.updateMany({ where: { videoId: job.videoId, status: { not: 'ready' } }, data: { status: 'failed', failureReason: 'Upload to local agent did not finish' } });
    }
  }

  private broadcast(job: any) {
    const view = this.publicView(job);
    if (job.createdById) this.realtime.emitEvent(`user_${job.createdById}`, VIDEO_JOB_EVENT, view);
  }

  private agentView(job: any) {
    return { jobId: job.id, videoId: job.videoId, fileName: job.fileName, fileSize: Number(job.fileSize), uploadSecret: job.uploadSecret, status: job.status };
  }

  private publicView(job: any) {
    return {
      id: job.id,
      mediaId: job.mediaId,
      videoId: job.videoId,
      fileName: job.fileName,
      fileSize: Number(job.fileSize),
      status: job.status,
      progress: job.progress,
      attempts: job.attempts,
      encoder: job.encoder,
      rungs: job.rungs,
      segmentCount: job.segmentCount,
      uploadedBytes: Number(job.uploadedBytes || 0),
      error: job.error,
      createdAt: job.createdAt,
      completedAt: job.completedAt,
    };
  }
}
