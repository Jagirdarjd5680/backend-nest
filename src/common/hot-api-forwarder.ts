import * as express from 'express';

/**
 * Routes served by python_service/hot_api (FastAPI) with the same URL + JSON contract as NestJS.
 * In production nginx sends these straight to FastAPI and they never reach Node. Without nginx
 * (local dev, or a server that only exposes :5001) this forwarder hands them to FastAPI; if FastAPI
 * is down it falls back to the NestJS route, so nothing ever breaks.
 */
const HOT_ROUTES = new Set([
  'POST /api/course-progress/lecture-watch', // video heartbeat — Redis-buffered writes
  // Public catalog reads fired on every app/web open — served from FastAPI's Redis cache
  'GET /api/courses',
  'GET /api/settings/public',
  'GET /api/banners/public',
  'GET /api/app-reviews',
]);

/** Set by FastAPI when it fetches a cache miss from NestJS — never forward those back (loop). */
export const HOT_API_ORIGIN_HEADER = 'x-hot-api-origin';

const FORWARD_TIMEOUT_MS = 3000;
const RETRY_AFTER_FAILURE_MS = 30_000;

export function hotApiForwarder(targetBaseUrl: string): express.RequestHandler {
  const base = targetBaseUrl.replace(/\/$/, '');
  let downUntil = 0;

  return (req, res, next) => {
    if (
      !HOT_ROUTES.has(`${req.method} ${req.path}`) ||
      req.headers[HOT_API_ORIGIN_HEADER] ||
      Date.now() < downUntil
    ) {
      return next();
    }

    // Registered before NestJS's body parser, so the raw body is still unread here.
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('error', next);
    req.on('end', async () => {
      const raw = Buffer.concat(chunks);
      const fallBackToNest = () => {
        // Hand the already-read body to NestJS; `_body` tells body-parser not to read it again.
        try {
          (req as any).body = raw.length ? JSON.parse(raw.toString('utf8')) : {};
        } catch {
          (req as any).body = {};
        }
        (req as any)._body = true;
        next();
      };

      try {
        const upstream = await fetch(base + req.originalUrl, {
          method: req.method,
          headers: {
            'content-type': req.headers['content-type'] || 'application/json',
            ...(req.headers.authorization ? { authorization: req.headers.authorization } : {}),
            ...(req.headers['x-platform'] ? { 'x-platform': String(req.headers['x-platform']) } : {}),
          },
          body: req.method === 'GET' || req.method === 'HEAD' ? undefined : raw,
          signal: AbortSignal.timeout(FORWARD_TIMEOUT_MS),
        });
        // FastAPI without DB/Redis answers 503 — let NestJS handle it instead.
        if (upstream.status >= 500) {
          downUntil = Date.now() + RETRY_AFTER_FAILURE_MS;
          return fallBackToNest();
        }
        res.status(upstream.status);
        res.setHeader('content-type', upstream.headers.get('content-type') || 'application/json');
        res.setHeader('x-served-by', 'hot-api');
        const cacheState = upstream.headers.get('x-cache');
        if (cacheState) res.setHeader('x-cache', cacheState);
        res.end(Buffer.from(await upstream.arrayBuffer()));
      } catch {
        downUntil = Date.now() + RETRY_AFTER_FAILURE_MS;
        console.warn(`⚠️ [HotAPI] ${base} unreachable — NestJS serves hot routes for ${RETRY_AFTER_FAILURE_MS / 1000}s`);
        fallBackToNest();
      }
    });
  };
}
