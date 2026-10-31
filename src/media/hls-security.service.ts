import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Encrypted HLS (AES-128) security:
 *
 *  - Every video gets its own random 16-byte key under storage/hls_keys/ — deliberately OUTSIDE
 *    uploads/, so neither the public /uploads static route nor /secure-media/sign can ever reach it.
 *  - Segments are encrypted, so they're served as plain static files (/hls-seg, or nginx/CDN) with
 *    no token and full caching. Without the key they're useless.
 *  - Node only handles the playlist (short play token) and the key (short key token bound to the
 *    same user + video, re-checked against enrollment and rate-limited on every fetch).
 *  - Tokens are stateless JWTs signed with a secret DERIVED from JWT_SECRET, so they survive a
 *    server restart (no mid-video "token expired") and can never be replayed as a login session.
 */

export const ENCRYPTED_SEGMENT_PREFIX = 'enc_';

/** How long a playlist URL stays usable for an encrypted video. The player loads it once at start. */
export const ENCRYPTED_PLAY_TOKEN_TTL = 10 * 60;
/** Legacy (unencrypted) videos still send every segment through Node with this token, all session long. */
export const LEGACY_PLAY_TOKEN_TTL = 6 * 60 * 60;
/** Key URL lifetime. Players fetch the key right after the playlist and keep it in memory. */
export const KEY_TOKEN_TTL = 10 * 60;

const ACCESS_CACHE_MS = 5 * 60 * 1000;
const KEY_RATE_WINDOW_MS = 60 * 60 * 1000;
const KEY_RATE_MAX = 60; // per user per video per hour — a normal viewer needs a handful
const GATED_ROLES = new Set(['student', 'parent']);

type TokenType = 'hls-play' | 'hls-key';

@Injectable()
export class HlsSecurityService {
  private readonly logger = new Logger('HlsSecurity');
  private readonly keysDir = path.join(process.cwd(), 'storage', 'hls_keys');
  private readonly secret = crypto
    .createHash('sha256')
    .update(`${process.env.JWT_SECRET || 'gog-dev-secret'}:hls-media-v1`)
    .digest('hex');

  private accessCache = new Map<string, { ok: boolean; at: number }>();
  private keyHits = new Map<string, number[]>();
  private keyCache = new Map<string, Buffer>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  // ─── Keys ──────────────────────────────────────────────────────────────

  private keyPath(videoId: string): string | null {
    if (!/^[\w-]+$/.test(videoId)) return null;
    return path.join(this.keysDir, `${videoId}.key`);
  }

  isEncrypted(videoId: string): boolean {
    const p = this.keyPath(videoId);
    return !!p && fs.existsSync(p);
  }

  /** Creates (or reuses) the video's key and returns the paths ffmpeg needs. */
  ensureKey(videoId: string): { keyPath: string; keyInfoPath: string; key: Buffer } {
    const key = this.ensureKeyBytes(videoId);
    const keyPath = this.keyPath(videoId) as string;
    // ffmpeg key-info: line 1 = URI written into the playlist (a placeholder we rewrite per
    // request), line 2 = key file. No IV line → the segment sequence number is the IV, which is
    // what players assume when EXT-X-KEY has no IV attribute.
    const keyInfoPath = path.join(this.keysDir, `${videoId}.keyinfo`);
    fs.writeFileSync(keyInfoPath, `key://${videoId}\n${keyPath}\n`);
    return { keyPath, keyInfoPath, key };
  }

  /** Creates (or reuses) the video's key without a keyinfo file — for the local agent, which writes its own. */
  ensureKeyBytes(videoId: string): Buffer {
    const keyPath = this.keyPath(videoId);
    if (!keyPath) throw new Error(`Invalid videoId for HLS key: ${videoId}`);
    fs.mkdirSync(this.keysDir, { recursive: true });
    if (!fs.existsSync(keyPath)) fs.writeFileSync(keyPath, crypto.randomBytes(16), { mode: 0o600 });
    return fs.readFileSync(keyPath);
  }

  readKey(videoId: string): Buffer {
    const cached = this.keyCache.get(videoId);
    if (cached) return cached;
    const p = this.keyPath(videoId);
    if (!p || !fs.existsSync(p)) throw new ForbiddenException('Video key not found');
    const key = fs.readFileSync(p);
    this.keyCache.set(videoId, key);
    return key;
  }

  deleteKey(videoId: string) {
    const p = this.keyPath(videoId);
    if (!p) return;
    this.keyCache.delete(videoId);
    for (const f of [p, p.replace(/\.key$/, '.keyinfo')]) {
      try {
        if (fs.existsSync(f)) fs.unlinkSync(f);
      } catch {}
    }
  }

  // ─── Tokens ────────────────────────────────────────────────────────────

  sign(type: TokenType, userId: number, videoId: string, ttlSeconds: number): string {
    return this.jwtService.sign({ typ: type, sub: userId, vid: videoId }, { secret: this.secret, expiresIn: ttlSeconds });
  }

  /** Returns the user id the token was minted for, or null if invalid/expired/for another video. */
  verify(type: TokenType, token: string | undefined, videoId: string): number | null {
    if (!token) return null;
    try {
      const p: any = this.jwtService.verify(token, { secret: this.secret });
      if (p?.typ !== type || p?.vid !== videoId) return null;
      const userId = Number(p.sub);
      return Number.isFinite(userId) && userId > 0 ? userId : null;
    } catch {
      return null;
    }
  }

  // ─── Access ────────────────────────────────────────────────────────────

  /**
   * Staff can watch everything. Students/parents can watch a video when it's free material, a free
   * preview lecture, or part of a course they're enrolled in. A video that isn't referenced by any
   * course at all (e.g. batch material) stays available to any logged-in user, so nothing that
   * worked before suddenly breaks for students.
   */
  async canAccess(userId: number, videoId: string): Promise<boolean> {
    const cacheKey = `${userId}:${videoId}`;
    const hit = this.accessCache.get(cacheKey);
    if (hit && Date.now() - hit.at < ACCESS_CACHE_MS) return hit.ok;

    const ok = await this.computeAccess(userId, videoId);
    this.accessCache.set(cacheKey, { ok, at: Date.now() });
    if (!ok) this.logger.warn(`🚫 Access denied user=${userId} video=${videoId}`);
    return ok;
  }

  private async computeAccess(userId: number, videoId: string): Promise<boolean> {
    const user: any = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.isActive === false || user.isBlocked) return false;
    if (!GATED_ROLES.has(String(user.role || 'student'))) return true;

    const needle = `/media/stream/${videoId}/`;

    const freeCount = await this.prisma.freeMaterial.count({ where: { url: { contains: needle } } });
    if (freeCount > 0) return true;

    const courseIds = new Set<number>();

    const lessons = await this.prisma.lesson.findMany({
      where: { url: { contains: needle } },
      select: { courseId: true, freePreview: true },
    });
    for (const l of lessons) {
      if (l.freePreview) return true;
      courseIds.add(l.courseId);
    }

    const courses = await this.prisma.$queryRaw<{ id: number; modules: any }[]>`
      SELECT id, modules FROM courses WHERE modules::text LIKE ${'%' + needle + '%'}`;
    for (const c of courses) {
      courseIds.add(c.id);
      const modules = Array.isArray(c.modules) ? c.modules : [];
      for (const m of modules) {
        for (const v of Array.isArray(m?.videos) ? m.videos : []) {
          const url = String(v?.url || v?.videoUrl || '');
          if (url.includes(needle) && (v.freePreview === true || v.isFree === true)) return true;
        }
      }
    }

    if (courseIds.size === 0) return true;

    const enrolled = await this.prisma.enrollment.count({
      where: { userId, courseId: { in: [...courseIds] } },
    });
    return enrolled > 0;
  }

  /** Throws when a user hammers the key endpoint (scripted ripping / token sharing). */
  assertKeyRate(userId: number, videoId: string) {
    const k = `${userId}:${videoId}`;
    const now = Date.now();
    const hits = (this.keyHits.get(k) || []).filter((t) => now - t < KEY_RATE_WINDOW_MS);
    if (hits.length >= KEY_RATE_MAX) {
      this.logger.warn(`🚫 Key rate limit user=${userId} video=${videoId}`);
      throw new ForbiddenException('Too many playback requests. Please try again later.');
    }
    hits.push(now);
    this.keyHits.set(k, hits);
  }
}
