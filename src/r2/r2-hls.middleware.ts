import type { NextFunction, Request, Response } from 'express';
import { existsSync } from 'fs';
import { join } from 'path';
import { R2Service } from './r2.service';

/**
 * Sits in main.ts's /hls-seg chain (after its encrypted-chunk/key check, before the static
 * server). A chunk still on local disk is served by the static server as before; one that was
 * moved to the bucket (R2Service.offloadHlsSegments) is streamed from there.
 * Chunks are AES-128 encrypted and the key never leaves the server, so this adds no exposure.
 */
export function r2HlsSegments(service: R2Service, hlsDir: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const rel = req.path.replace(/^\/+/, '');
    if (existsSync(join(hlsDir, rel))) return next();
    try {
      const upstream = await service.openHlsSegment(rel, {
        range: req.headers.range,
        ifNoneMatch: req.headers['if-none-match'] as string | undefined,
      });
      if (!upstream) return next(); // static server answers 404
      const partial = upstream.statusCode === 200 && !!upstream.headers['content-range'];
      res.status(partial ? 206 : upstream.statusCode || 200);
      for (const h of ['content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']) {
        const v = upstream.headers[h];
        if (v !== undefined) res.setHeader(h, v);
      }
      res.setHeader('Content-Type', 'video/mp2t');
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      req.on('close', () => upstream.destroy());
      upstream.pipe(res);
    } catch {
      next();
    }
  };
}
