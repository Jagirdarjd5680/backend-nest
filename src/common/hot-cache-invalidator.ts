import * as express from 'express';
import Redis from 'ioredis';

/**
 * python_service/hot_api caches the public catalog reads (courses, public settings, public banners,
 * app reviews) in Redis. After any successful write under these routes, bump that group's
 * generation (`hot:gen:<group>`) so the next read misses and re-fetches — admin changes show up
 * immediately instead of after the cache TTL. Must match CACHED_ROUTES in hot_api/catalog.py.
 */
const WRITE_GROUPS: Array<[prefix: string, group: string]> = [
  ['/api/courses', 'courses'],
  ['/api/categories', 'courses'], // course list embeds the category name
  ['/api/settings', 'settings'],
  ['/api/banners', 'banners'],
  ['/api/app-reviews', 'app-reviews'],
];

// Student actions under /api/courses that don't change the cached course list.
const IGNORED = [/\/like$/, /\/reviews(\/|$)/];

export function hotCacheInvalidator(): express.RequestHandler {
  let redis: Redis | null = null;
  const client = () => {
    if (!redis) {
      redis = new Redis({
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
        password: process.env.REDIS_PASSWORD || undefined,
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
      });
      redis.on('error', () => {}); // no Redis = nothing cached = nothing to invalidate
    }
    return redis;
  };

  return (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
    const path = req.path;
    const match = WRITE_GROUPS.find(([prefix]) => path === prefix || path.startsWith(prefix + '/'));
    if (!match || IGNORED.some((re) => re.test(path))) return next();

    res.on('finish', () => {
      if (res.statusCode >= 400) return;
      const r = client();
      const bump = () => r.incr(`hot:gen:${match[1]}`).catch(() => {});
      if (r.status === 'wait') r.connect().then(bump).catch(() => {});
      else bump();
    });
    next();
  };
}
