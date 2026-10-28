import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { MediaAccessService } from './media-access.service';

// Longer than the native app's 90s (backend_nestjs/src/media-access/media-access.service.ts) —
// that one re-signs fresh right before display every time; this one signs ONCE into a whole API
// response payload that the web app may hold in memory/cache for a while (its own 5s GET cache,
// plus however long the tab stays open before refetching), so it needs enough headroom that
// images don't start failing to load mid-session.
const RESPONSE_SIGNED_TTL_SECONDS = 15 * 60;

const UPLOADS_PATH = /^\/uploads\/(?!hls\/)/;

// An already-signed URL that got saved into the DB verbatim (e.g. the admin media picker hands
// back a signed URL and a form stores it). Its baked-in token expires after the TTL above, so
// re-sign it on the way out just like a raw /uploads path. Optional host prefix is kept.
const STORED_SIGNED_URL = /^(\S*?)\/api\/secure-media\/file\?(\S+)$/;

/**
 * Web's fixUrl() (frontend/src/utils/api.js) is synchronous and called inline in JSX across the
 * whole admin panel — there's no per-render hook point to fetch a fresh token like the native app
 * does. So instead, this interceptor rewrites any raw `/uploads/...` string found anywhere in a
 * JSON response into a signed /secure-media/file URL before it ever reaches the browser. fixUrl()
 * only needs to host-prefix an already-signed URL, never mint one itself.
 *
 * Only signs for authenticated requests (req.user set by JwtAuthGuard on that route) — public,
 * unauthenticated endpoints (marketing pages, public course listings) keep serving the raw path,
 * since there is no user to scope a token to and that content is meant to be public anyway.
 */
@Injectable()
export class MediaUrlSigningInterceptor implements NestInterceptor {
  constructor(private readonly mediaAccessService: MediaAccessService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const userId = Number(request?.user?.id || request?.user?._id);

    const res = context.switchToHttp().getResponse();
    // Already-sent replies (@Res handlers) can hand back the circular Express response object.
    return next.handle().pipe(
      map((data) => (!res?.headersSent && Number.isFinite(userId) && userId > 0 ? this.transform(data, userId) : data)),
    );
  }

  private transform(value: any, userId: number): any {
    if (value === null || value === undefined) return value;

    if (typeof value === 'string') {
      if (UPLOADS_PATH.test(value)) {
        const relativePath = value.replace(/^\/uploads\//, '').split('?')[0];
        const { token } = this.mediaAccessService.signMediaToken(userId, relativePath, RESPONSE_SIGNED_TTL_SECONDS);
        return `/api/secure-media/file?path=${encodeURIComponent(relativePath)}&token=${encodeURIComponent(token)}`;
      }
      const stored = value.match(STORED_SIGNED_URL);
      if (stored) {
        const params = new URLSearchParams(stored[2]);
        const relativePath = params.get('path');
        if (!relativePath) return value;
        const { token } = this.mediaAccessService.signMediaToken(userId, relativePath, RESPONSE_SIGNED_TTL_SECONDS);
        params.set('token', token);
        return `${stored[1]}/api/secure-media/file?${params.toString()}`;
      }
      return value;
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.transform(item, userId));
    }

    if (typeof value === 'object' && !(value instanceof Date) && !Buffer.isBuffer(value)) {
      const out: Record<string, any> = {};
      for (const key of Object.keys(value)) {
        out[key] = this.transform(value[key], userId);
      }
      return out;
    }

    return value;
  }
}
