import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import * as https from 'https';
import { Readable } from 'stream';
import { PrismaService } from '../prisma/prisma.service';
import { encodeKeyPath, presignUrl, signHeaders, SigV4Credentials } from './r2.sigv4';

/**
 * Cloudflare R2 (S3 API) offload for the Media Library.
 *
 * Everything about this integration lives in src/r2/. Other modules only call the
 * `tryOffload*` / `deleteByUrl` hooks below (marked `[r2]` at the call sites), so
 * removing it = delete this folder + those marked lines + the import in app.module.ts.
 *
 * Config is a single Settings row (key `r2`), edited from the web admin's
 * Settings → Storage page. All of it — account ID, bucket, keys — is dynamic.
 * The S3 endpoint is derived from the account ID; R2's signing region is always `auto`.
 *
 * Stored file URLs:
 *  - no publicBaseUrl → `/api/r2/file/<key>` (this backend streams the object from
 *    the private bucket, so the bucket never has to be public or need CORS)
 *  - publicBaseUrl set → `<publicBaseUrl>/<key>` (r2.dev / custom domain, served by Cloudflare)
 */

export const R2_SETTINGS_KEY = 'r2';
export const R2_FILE_PREFIX = '/api/r2/file/';
// Fixed (not under `folder`) so chunks stay reachable if the folder setting changes later.
const HLS_PREFIX = 'hls/';
const R2_REGION = 'auto';

export interface R2Config {
  enabled: boolean;
  /** Cloudflare account ID — R2 dashboard → "Account details". */
  accountId: string;
  /** Derived from accountId; not stored. */
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Optional public/CDN base URL; when set, files are linked directly instead of streamed through this server. */
  publicBaseUrl: string;
  /** Key prefix inside the bucket. */
  folder: string;
  /**
   * Videos are always converted to encrypted HLS on this server (raw MP4s never go to the
   * bucket). When true, the finished AES-encrypted .ts chunks are then moved to the bucket —
   * playlists and keys stay on the server, so a chunk on its own can't be played.
   */
  uploadVideos: boolean;
}

export const DEFAULT_R2_CONFIG: R2Config = {
  enabled: false,
  accountId: '',
  endpoint: '',
  bucket: '',
  accessKeyId: '',
  secretAccessKey: '',
  publicBaseUrl: '',
  folder: 'media',
  uploadVideos: false,
};

const CONFIG_CACHE_MS = 30_000;

// Files above this go up as a parallel multipart upload instead of one PUT.
const MULTIPART_THRESHOLD = 16 * 1024 * 1024;
const MULTIPART_PART_SIZE = 8 * 1024 * 1024;
const MULTIPART_CONCURRENCY = 8;
// HLS chunks are small (a few hundred KB each), so many in flight at once is what makes the move fast.
const HLS_CONCURRENCY = 16;
const MULTIPART_RETRIES = 3;

const MIME_BY_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.aac': 'audio/aac',
  '.zip': 'application/zip', '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.ppt': 'application/vnd.ms-powerpoint', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.xls': 'application/vnd.ms-excel', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.txt': 'text/plain',
};

@Injectable()
export class R2Service {
  private readonly logger = new Logger('R2');
  private cached: { config: R2Config; at: number } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  // ─── Config ──────────────────────────────────────────────────────────────

  async getConfig(): Promise<R2Config> {
    if (this.cached && Date.now() - this.cached.at < CONFIG_CACHE_MS) return this.cached.config;
    let stored: Partial<R2Config> = {};
    const row = await this.prisma.settings.findUnique({ where: { key: R2_SETTINGS_KEY } });
    if (row?.value) {
      try {
        stored = JSON.parse(row.value);
      } catch {}
    }
    const config = this.normalize({ ...DEFAULT_R2_CONFIG, ...stored });
    this.cached = { config, at: Date.now() };
    return config;
  }

  /** Admin view — the secret never leaves the server. */
  async getMaskedConfig() {
    const { secretAccessKey, ...rest } = await this.getConfig();
    return { ...rest, secretAccessKey: '', hasSecret: !!secretAccessKey };
  }

  /** Saves a partial update. An empty secret keeps the stored one. */
  async saveConfig(patch: Partial<R2Config>) {
    const current = await this.getConfig();
    const next = this.normalize({
      ...current,
      ...this.pickKnown(patch),
      secretAccessKey: patch.secretAccessKey ? String(patch.secretAccessKey) : current.secretAccessKey,
    });
    const value = JSON.stringify(next);
    await this.prisma.settings.upsert({
      where: { key: R2_SETTINGS_KEY },
      create: { key: R2_SETTINGS_KEY, value },
      update: { value },
    });
    this.cached = { config: next, at: Date.now() };
    return this.getMaskedConfig();
  }

  private pickKnown(patch: any): Partial<R2Config> {
    const out: any = {};
    for (const k of Object.keys(DEFAULT_R2_CONFIG)) {
      if (k !== 'secretAccessKey' && patch?.[k] !== undefined) out[k] = patch[k];
    }
    return out;
  }

  private normalize(c: R2Config): R2Config {
    const accountId = String(c.accountId || '').trim().toLowerCase();
    return {
      enabled: !!c.enabled,
      accountId,
      endpoint: /^[a-f0-9]{32}$/.test(accountId) ? `https://${accountId}.r2.cloudflarestorage.com` : '',
      bucket: String(c.bucket || '').trim(),
      accessKeyId: String(c.accessKeyId || '').trim(),
      secretAccessKey: String(c.secretAccessKey || '').trim(),
      publicBaseUrl: String(c.publicBaseUrl || '').trim().replace(/\/+$/, ''),
      folder: String(c.folder ?? 'media').trim().replace(/^\/+|\/+$/g, ''),
      uploadVideos: !!c.uploadVideos,
    };
  }

  private hasCredentials(c: R2Config) {
    return !!(c.endpoint && c.bucket && c.accessKeyId && c.secretAccessKey);
  }

  private creds(c: R2Config): SigV4Credentials {
    return { accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey, region: R2_REGION };
  }

  private objectUrl(c: R2Config, key: string) {
    return new URL(`${c.endpoint}/${encodeKeyPath(c.bucket)}/${encodeKeyPath(key)}`);
  }

  // ─── Upload hooks (called from UploadsService) ──────────────────────────

  /**
   * Uploads an in-memory file when R2 is enabled. Returns the URL to store on the
   * Media row, or null — in which case the caller keeps its normal local-disk flow. Upload
   * errors also return null (falls back to local) so an outage never loses an upload.
   */
  async tryOffloadBuffer(buffer: Buffer, fileName: string, contentType: string, opts: { isVideo: boolean }) {
    const config = await this.shouldOffload(opts.isVideo);
    if (!config) return null;
    const key = this.buildKey(config, fileName);
    try {
      await this.uploadObject(config, key, buffer.length, contentType || this.mimeFor(fileName), (start, end) => buffer.subarray(start, end));
      return this.fileUrl(config, key);
    } catch (err: any) {
      this.logger.error(`Upload failed, keeping file on local disk: ${err?.message}`);
      return null;
    }
  }

  /** Same as tryOffloadBuffer for a file already on disk; deletes the local copy on success. */
  async tryOffloadFile(filePath: string, fileName: string, opts: { isVideo: boolean }) {
    const config = await this.shouldOffload(opts.isVideo);
    if (!config || !fs.existsSync(filePath)) return null;
    const key = this.buildKey(config, fileName);
    try {
      const size = fs.statSync(filePath).size;
      // end is exclusive here; createReadStream's is inclusive
      await this.uploadObject(config, key, size, this.mimeFor(fileName), (start, end) => fs.createReadStream(filePath, { start, end: end - 1 }));
      fs.promises.unlink(filePath).catch(() => {});
      return this.fileUrl(config, key);
    } catch (err: any) {
      this.logger.error(`Upload failed, keeping file on local disk: ${err?.message}`);
      return null;
    }
  }

  /** Deletes the bucket object behind a stored Media URL. Returns false for non-bucket URLs. */
  async deleteByUrl(url?: string | null): Promise<boolean> {
    if (!url) return false;
    const config = await this.getConfig();
    const key = this.keyFromUrl(url, config);
    if (!key) return false;
    if (!this.hasCredentials(config)) return true;
    try {
      await this.request(config, 'DELETE', this.objectUrl(config, key));
    } catch (err: any) {
      this.logger.warn(`Delete failed for ${key}: ${err?.message}`);
    }
    return true;
  }

  private async shouldOffload(isVideo: boolean) {
    const config = await this.getConfig();
    if (!config.enabled || !this.hasCredentials(config)) return null;
    // Raw videos stay on disk for the encrypted-HLS conversion; only its chunks may move later.
    if (isVideo) return null;
    return config;
  }

  // ─── Encrypted HLS chunks ────────────────────────────────────────────────

  /**
   * Moves a converted video's encrypted chunks (enc_*.ts) to the bucket under hls/<videoId>/,
   * deleting each local copy once uploaded. Called after conversion finishes. Only runs for
   * encrypted videos (key file present) — plain chunks would be playable straight from a URL.
   */
  async offloadHlsSegments(videoId: string, hlsBaseDir: string, keysDir: string) {
    const config = await this.getConfig();
    if (!config.enabled || !config.uploadVideos || !this.hasCredentials(config)) return;
    if (!/^[\w-]+$/.test(videoId) || !fs.existsSync(path.join(keysDir, `${videoId}.key`))) return;
    const videoDir = path.join(hlsBaseDir, videoId);
    if (!fs.existsSync(videoDir)) return;

    const files: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (/^enc_\d+\.ts$/.test(e.name)) files.push(full);
      }
    };
    walk(videoDir);
    if (!files.length) return;

    const startedAt = Date.now();
    let bytes = 0;
    let failed = 0;
    let next = 0;
    const worker = async () => {
      while (next < files.length) {
        if (!fs.existsSync(videoDir)) return; // video deleted meanwhile — stop moving chunks
        const file = files[next++];
        const rel = path.relative(hlsBaseDir, file).split(path.sep).join('/');
        const size = fs.statSync(file).size;
        try {
          await this.withRetry(() => this.putObject(config, `${HLS_PREFIX}${rel}`, fs.createReadStream(file), size, 'video/mp2t'));
          bytes += size;
          await fs.promises.unlink(file).catch(() => {});
        } catch (err: any) {
          failed++; // stays on local disk and keeps being served from there
          this.logger.warn(`HLS chunk ${rel} not moved: ${err?.message}`);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(HLS_CONCURRENCY, files.length) }, worker));
    // Deleted from the library while chunks were in flight: its delete already ran, so remove
    // whatever landed after it instead of leaving orphans in the bucket.
    if (!fs.existsSync(videoDir)) {
      await this.deleteHlsSegments(videoId);
      this.logger.log(`Video ${videoId} was deleted during the move — its bucket chunks were removed`);
      return;
    }
    const secs = Math.max(0.001, (Date.now() - startedAt) / 1000);
    this.logger.log(
      `Moved ${files.length - failed}/${files.length} encrypted HLS chunks of ${videoId} — ` +
        `${(bytes / 1048576).toFixed(1)} MB in ${secs.toFixed(1)}s (${(bytes / 1048576 / secs).toFixed(2)} MB/s)`,
    );
  }

  /** Streams one encrypted chunk (path as under /hls-seg, e.g. "<videoId>/720p/enc_00001.ts"). */
  openHlsSegment(relPath: string, fwd: { range?: string; ifNoneMatch?: string } = {}) {
    return this.openObject(`${HLS_PREFIX}${relPath}`, fwd);
  }

  /**
   * True when a converted video's chunks have all moved to the bucket: its playlist is still on
   * disk but no .ts chunk is. Disk-only check (no network), so the library list stays fast.
   */
  hlsInBucket(videoId: string, hlsBaseDir: string): boolean {
    if (!/^[\w-]+$/.test(videoId)) return false;
    const dir = path.join(hlsBaseDir, videoId);
    if (!fs.existsSync(path.join(dir, 'master.m3u8'))) return false;
    const hasLocalChunk = (d: string): boolean =>
      fs.readdirSync(d, { withFileTypes: true }).some((e) => (e.isDirectory() ? hasLocalChunk(path.join(d, e.name)) : e.name.endsWith('.ts')));
    return !hasLocalChunk(dir);
  }

  /**
   * Base URL players should fetch this video's encrypted chunks from, when they can come straight
   * from Cloudflare: a public domain is set and every chunk has moved to the bucket. Null otherwise
   * (some still on disk, or a private bucket) — the caller then keeps the /hls-seg route.
   * Bucket layout hls/<videoId>/<quality>/enc_*.ts mirrors /hls-seg, so only the base changes.
   */
  async hlsPublicBase(videoId: string, hlsBaseDir: string): Promise<string | null> {
    const config = await this.getConfig();
    if (!config.publicBaseUrl || !this.hlsInBucket(videoId, hlsBaseDir)) return null;
    return `${config.publicBaseUrl}/${HLS_PREFIX.replace(/\/$/, '')}`;
  }

  // ─── Local video agent (src/video-agent/) ────────────────────────────────

  /** True when the bucket is configured well enough for the local agent to upload into it. */
  async canAcceptAgentUploads() {
    const config = await this.getConfig();
    return config.enabled && this.hasCredentials(config);
  }

  /**
   * Presigned PUT URLs for chunks under hls/<videoId>/ (paths like "720p/enc_00001.ts"). The
   * agent uploads straight to Cloudflare with them — video bytes never pass through this server.
   */
  async presignHlsPuts(videoId: string, relPaths: string[], expiresSeconds = 3600) {
    const config = await this.getConfig();
    if (!this.hasCredentials(config)) throw new Error('R2 is not configured');
    const out: Record<string, string> = {};
    for (const rel of relPaths) {
      out[rel] = presignUrl({
        creds: this.creds(config),
        url: this.objectUrl(config, `${HLS_PREFIX}${videoId}/${rel}`),
        expiresSeconds,
        method: 'PUT',
      });
    }
    return out;
  }

  /** Every chunk of a video in the bucket with its size, keyed by path under hls/<videoId>/. */
  async listHlsObjects(videoId: string): Promise<Map<string, number>> {
    const config = await this.getConfig();
    if (!this.hasCredentials(config)) throw new Error('R2 is not configured');
    const prefix = `${HLS_PREFIX}${videoId}/`;
    const items = new Map<string, number>();
    let token: string | undefined;
    do {
      const u = new URL(`${config.endpoint}/${encodeKeyPath(config.bucket)}`);
      u.searchParams.set('list-type', '2');
      u.searchParams.set('prefix', prefix);
      if (token) u.searchParams.set('continuation-token', token);
      const xml = (await this.request(config, 'GET', u)).body.toString();
      for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
        const key = (/<Key>([^<]+)<\/Key>/.exec(m[1])?.[1] || '').replace(/&amp;/g, '&');
        items.set(key.slice(prefix.length), Number(/<Size>(\d+)<\/Size>/.exec(m[1])?.[1] || 0));
      }
      token = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? /<NextContinuationToken>([^<]+)</.exec(xml)?.[1] : undefined;
    } while (token);
    return items;
  }

  /** How many encrypted chunks of a video are in the bucket (dev test page progress). */
  async countHlsChunks(videoId: string) {
    const config = await this.getConfig();
    if (!this.hasCredentials(config) || !/^[\w-]+$/.test(videoId)) return 0;
    return (await this.listKeys(config, `${HLS_PREFIX}${videoId}/`)).length;
  }

  /** Removes every bucket chunk of a video (called when the video is deleted). */
  async deleteHlsSegments(videoId?: string | null) {
    if (!videoId || !/^[\w-]+$/.test(videoId)) return;
    const config = await this.getConfig();
    if (!this.hasCredentials(config)) return;
    try {
      const keys = await this.listKeys(config, `${HLS_PREFIX}${videoId}/`);
      let next = 0;
      const worker = async () => {
        while (next < keys.length) {
          const key = keys[next++];
          await this.request(config, 'DELETE', this.objectUrl(config, key)).catch(() => {});
        }
      };
      await Promise.all(Array.from({ length: Math.min(HLS_CONCURRENCY, keys.length) }, worker));
    } catch (err: any) {
      this.logger.warn(`Could not delete HLS chunks of ${videoId}: ${err?.message}`);
    }
  }

  // ─── Dev test page helpers (r2-dev.controller.ts) ───────────────

  /** Every object in the bucket with size/date — for the local test page. */
  async listObjects() {
    const config = await this.getConfig();
    if (!this.hasCredentials(config)) throw new Error('R2 is not configured');
    const items: { key: string; size: number; lastModified: string }[] = [];
    let token: string | undefined;
    do {
      const u = new URL(`${config.endpoint}/${encodeKeyPath(config.bucket)}`);
      u.searchParams.set('list-type', '2');
      if (token) u.searchParams.set('continuation-token', token);
      const xml = (await this.request(config, 'GET', u)).body.toString();
      for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
        items.push({
          key: (/<Key>([^<]+)<\/Key>/.exec(m[1])?.[1] || '').replace(/&amp;/g, '&'),
          size: Number(/<Size>(\d+)<\/Size>/.exec(m[1])?.[1] || 0),
          lastModified: /<LastModified>([^<]+)<\/LastModified>/.exec(m[1])?.[1] || '',
        });
      }
      token = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? /<NextContinuationToken>([^<]+)</.exec(xml)?.[1] : undefined;
    } while (token);
    return items;
  }

  async deleteKey(key: string) {
    const config = await this.getConfig();
    if (!this.hasCredentials(config)) throw new Error('R2 is not configured');
    await this.request(config, 'DELETE', this.objectUrl(config, key));
  }

  private async listKeys(config: R2Config, prefix: string) {
    const keys: string[] = [];
    let token: string | undefined;
    do {
      const u = new URL(`${config.endpoint}/${encodeKeyPath(config.bucket)}`);
      u.searchParams.set('list-type', '2');
      u.searchParams.set('prefix', prefix);
      if (token) u.searchParams.set('continuation-token', token);
      const xml = (await this.request(config, 'GET', u)).body.toString();
      for (const m of xml.matchAll(/<Key>([^<]+)<\/Key>/g)) keys.push(m[1].replace(/&amp;/g, '&'));
      token = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? /<NextContinuationToken>([^<]+)</.exec(xml)?.[1] : undefined;
    } while (token);
    return keys;
  }

  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await fn();
      } catch (err) {
        if (attempt >= MULTIPART_RETRIES) throw err;
        await new Promise((r) => setTimeout(r, 1000 * attempt));
      }
    }
  }

  private buildKey(config: R2Config, fileName: string) {
    const now = new Date();
    const safe = path.basename(fileName).replace(/[^a-zA-Z0-9._-]/g, '_');
    const dated = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${safe}`;
    return config.folder ? `${config.folder}/${dated}` : dated;
  }

  private fileUrl(config: R2Config, key: string) {
    return config.publicBaseUrl ? `${config.publicBaseUrl}/${encodeKeyPath(key)}` : `${R2_FILE_PREFIX}${encodeKeyPath(key)}`;
  }

  /** Extracts the object key from either stored URL form; null when it isn't a bucket URL. */
  keyFromUrl(url: string, config: R2Config): string | null {
    const clean = url.split('?')[0];
    const idx = clean.indexOf(R2_FILE_PREFIX);
    if (idx !== -1) return decodeURIComponent(clean.slice(idx + R2_FILE_PREFIX.length));
    if (config.publicBaseUrl && clean.startsWith(config.publicBaseUrl + '/')) {
      return decodeURIComponent(clean.slice(config.publicBaseUrl.length + 1));
    }
    return null;
  }

  mimeFor(fileName: string) {
    return MIME_BY_EXT[path.extname(fileName).toLowerCase()] || 'application/octet-stream';
  }

  // ─── Serving ─────────────────────────────────────────────────────────────

  /**
   * Opens a header-signed GET on the bucket object and hands back the raw response for the
   * controller to pipe through. Files are proxied rather than redirected to a presigned URL so
   * the bucket needs no public access or CORS rules. `range`/`ifNoneMatch` are forwarded so video seeking and
   * browser revalidation work. Resolves null when the object (or config) doesn't exist.
   */
  async openObject(key: string, fwd: { range?: string; ifNoneMatch?: string } = {}): Promise<http.IncomingMessage | null> {
    const config = await this.getConfig();
    if (!this.hasCredentials(config)) return null;
    const url = this.objectUrl(config, key);
    const headers: Record<string, string> = {};
    if (fwd.range) headers.range = fwd.range;
    if (fwd.ifNoneMatch) headers['if-none-match'] = fwd.ifNoneMatch;
    const signed = signHeaders({ creds: this.creds(config), method: 'GET', url, headers });
    const client = url.protocol === 'http:' ? http : https;
    return new Promise((resolve, reject) => {
      const req = client.request(url, { method: 'GET', headers: signed }, (res) => {
        const status = res.statusCode || 0;
        if (status === 200 || status === 206 || status === 304) return resolve(res);
        res.resume();
        if (status === 404 || status === 403) return resolve(null);
        reject(new Error(`GET ${status}`));
      });
      req.on('error', reject);
      req.end();
    });
  }

  // ─── Connection test ─────────────────────────────────────────────────────

  /** Writes, reads back and deletes a tiny object. `override` lets the admin test unsaved values. */
  async testConnection(override?: Partial<R2Config>) {
    const current = await this.getConfig();
    const config = this.normalize({
      ...current,
      ...this.pickKnown(override || {}),
      secretAccessKey: override?.secretAccessKey || current.secretAccessKey,
    });
    if (!this.hasCredentials(config)) {
      return { success: false, message: 'Account ID (32 hex characters), bucket, access key and secret key are all required.' };
    }
    const key = `${config.folder ? config.folder + '/' : ''}.connection-test-${Date.now()}.txt`;
    const body = Buffer.from('ok');
    try {
      await this.putObject(config, key, body, body.length, 'text/plain');
      const read = await this.request(config, 'GET', this.objectUrl(config, key));
      await this.request(config, 'DELETE', this.objectUrl(config, key));
      if (read.body.toString() !== 'ok') throw new Error('Uploaded test file could not be read back');
      return { success: true, message: `Connected to bucket "${config.bucket}" — upload, read and delete all work.` };
    } catch (err: any) {
      return { success: false, message: err?.message || 'Connection failed' };
    }
  }

  // ─── Low-level S3 calls ──────────────────────────────────────────────────

  /**
   * Small files: one PUT. Large files: S3 multipart upload with several parts in flight at
   * once — a single connection to the bucket tops out well below the line speed, so parallel
   * parts make big videos go up several times faster. Each part is retried a few times.
   */
  private async uploadObject(
    config: R2Config,
    key: string,
    size: number,
    contentType: string,
    readRange: (start: number, end: number) => Buffer | Readable,
  ) {
    const startedAt = Date.now();
    if (size <= MULTIPART_THRESHOLD) {
      await this.putObject(config, key, readRange(0, size), size, contentType);
    } else {
      await this.multipartUpload(config, key, size, contentType, readRange);
    }
    const secs = Math.max(0.001, (Date.now() - startedAt) / 1000);
    this.logger.log(`Uploaded ${key} — ${(size / 1048576).toFixed(1)} MB in ${secs.toFixed(1)}s (${(size / 1048576 / secs).toFixed(2)} MB/s)`);
  }

  private async multipartUpload(
    config: R2Config,
    key: string,
    size: number,
    contentType: string,
    readRange: (start: number, end: number) => Buffer | Readable,
  ) {
    const base = this.objectUrl(config, key);
    const withQuery = (q: Record<string, string>) => {
      const u = new URL(base.toString());
      for (const [k, v] of Object.entries(q)) u.searchParams.set(k, v);
      return u;
    };

    const created = await this.request(config, 'POST', withQuery({ uploads: '' }), undefined, { 'content-type': contentType });
    const uploadId = /<UploadId>([^<]+)<\/UploadId>/.exec(created.body.toString())?.[1];
    if (!uploadId) throw new Error('Multipart upload could not be started');

    // S3 allows at most 10,000 parts; keep parts ≥ MULTIPART_PART_SIZE.
    const partSize = Math.max(MULTIPART_PART_SIZE, Math.ceil(size / 10000));
    const partCount = Math.ceil(size / partSize);
    const etags: string[] = new Array(partCount);

    const uploadPart = async (index: number) => {
      const start = index * partSize;
      const end = Math.min(size, start + partSize);
      for (let attempt = 1; ; attempt++) {
        try {
          const res = await this.request(
            config,
            'PUT',
            withQuery({ partNumber: String(index + 1), uploadId }),
            readRange(start, end),
            { 'content-length': String(end - start) },
          );
          const etag = res.headers['etag'];
          if (!etag) throw new Error(`Part ${index + 1} returned no ETag`);
          etags[index] = String(etag);
          return;
        } catch (err) {
          if (attempt >= MULTIPART_RETRIES) throw err;
          await new Promise((r) => setTimeout(r, 1000 * attempt));
        }
      }
    };

    try {
      let next = 0;
      const worker = async () => {
        while (next < partCount) await uploadPart(next++);
      };
      await Promise.all(Array.from({ length: Math.min(MULTIPART_CONCURRENCY, partCount) }, worker));

      const xml =
        '<CompleteMultipartUpload>' +
        etags.map((etag, i) => `<Part><PartNumber>${i + 1}</PartNumber><ETag>${etag}</ETag></Part>`).join('') +
        '</CompleteMultipartUpload>';
      const body = Buffer.from(xml);
      const done = await this.request(config, 'POST', withQuery({ uploadId }), body, {
        'content-type': 'application/xml',
        'content-length': String(body.length),
      });
      // S3 can answer 200 with an <Error> body when completion fails.
      if (/<Error>/.test(done.body.toString())) throw new Error(`Multipart complete failed: ${done.body.toString().slice(0, 200)}`);
    } catch (err) {
      await this.request(config, 'DELETE', withQuery({ uploadId })).catch(() => {});
      throw err;
    }
  }

  private putObject(config: R2Config, key: string, body: Buffer | Readable, size: number, contentType: string) {
    return this.request(config, 'PUT', this.objectUrl(config, key), body, {
      'content-type': contentType,
      'content-length': String(size),
    });
  }

  private request(
    config: R2Config,
    method: string,
    url: URL,
    body?: Buffer | Readable,
    headers: Record<string, string> = {},
  ): Promise<{ status: number; body: Buffer; headers: http.IncomingHttpHeaders }> {
    const signed = signHeaders({ creds: this.creds(config), method, url, headers });
    const client = url.protocol === 'http:' ? http : https;
    return new Promise((resolve, reject) => {
      const req = client.request(url, { method, headers: signed, timeout: 10 * 60 * 1000 }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const status = res.statusCode || 0;
          const resBody = Buffer.concat(chunks);
          if (status >= 200 && status < 300) return resolve({ status, body: resBody, headers: res.headers });
          const code = /<Code>([^<]+)<\/Code>/.exec(resBody.toString())?.[1];
          const msg = /<Message>([^<]+)<\/Message>/.exec(resBody.toString())?.[1];
          reject(new Error(`${method} ${status}${code ? ` ${code}` : ''}${msg ? `: ${msg}` : ''}`));
        });
      });
      req.on('timeout', () => req.destroy(new Error('Request timed out')));
      req.on('error', reject);
      if (!body) return req.end();
      if (Buffer.isBuffer(body)) return req.end(body);
      body.on('error', (e) => req.destroy(e));
      body.pipe(req);
    });
  }
}
