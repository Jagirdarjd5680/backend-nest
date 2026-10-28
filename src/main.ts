import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { AppModule } from './app.module';
import * as dotenv from 'dotenv';
import * as express from 'express';
import { join } from 'path';
import { existsSync } from 'fs';
import { MongoIdInterceptor } from './common/interceptors/mongo-id.interceptor';
import { MediaUrlSigningInterceptor } from './media-access/media-url-signing.interceptor';
import { FriendlyExceptionFilter } from './common/filters/friendly-exception.filter';
import { hotApiForwarder } from './common/hot-api-forwarder';
import { hotCacheInvalidator } from './common/hot-cache-invalidator';
import { decoy404 } from './common/decoy-404';
import { R2Service } from './r2/r2.service'; // [r2]
import { r2HlsSegments } from './r2/r2-hls.middleware'; // [r2]

dotenv.config();

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Standard HTTP-header hardening (clickjacking, MIME sniffing, etc.). CSP disabled: this API
  // serves HLS playlists/segments and uploaded media directly, and the default CSP would block them.
  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: false }));

  // The backend domain looks empty: anything that isn't an app path (and any API URL opened
  // straight in a browser tab) gets a bare web-server 404. See common/decoy-404.ts.
  app.use(decoy404());

  // Global prefix
  app.setGlobalPrefix('api');

  // Register Global Interceptor for MongoDB compatibility
  app.useGlobalInterceptors(new MongoIdInterceptor(), app.get(MediaUrlSigningInterceptor));
  app.useGlobalFilters(new FriendlyExceptionFilter());

  // HLS output must never be public: playlists/segments go through /api/media/stream (token +
  // enrollment) and encrypted segments through /hls-seg below. Without this block, the static
  // route underneath served every video chunk to anyone who could guess the URL.
  app.use('/uploads/hls', (_req: express.Request, res: express.Response) => res.status(404).end());

  // Static uploads directory serving
  app.use('/uploads', express.static(join(__dirname, '..', 'uploads')));

  // CORS setup
  const frontendUrls = (process.env.FRONTEND_URL || 'http://localhost:5173').split(',').map(url => url.trim());
  const allowedOrigins = [
    ...frontendUrls,
    'http://localhost:5173',
    'http://localhost:5174',
    'http://192.168.31.7:5173',
    'http://192.168.31.7:5174',
    'https://dashboard.godofgraphics.in',
    'https://backend.godofgraphics.in',
    'https://app.godofgraphics.in',
  ];

  app.enableCors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return callback(null, true);
      callback(new Error(`CORS blocked: ${origin}`));
    },
    credentials: true,
  });

  // High-traffic routes → python_service FastAPI (falls back to NestJS if it's down).
  // Must come AFTER enableCors: forwarded replies skip NestJS's own pipeline, so CORS headers have
  // to be added before they're sent, or the web panel's browser blocks them.
  // HOT_API_FORWARD=false keeps everything on NestJS.
  // Admin writes to courses/settings/banners/app-reviews refresh FastAPI's catalog cache instantly.
  app.use(hotCacheInvalidator());
  if (process.env.HOT_API_FORWARD !== 'false') {
    app.use(hotApiForwarder(process.env.HOT_API_URL || process.env.PYTHON_AI_SERVICE_URL || 'http://localhost:8000'));
  }

  // Encrypted HLS segments (AES-128). Useless without the per-user key from /api/media/key, so
  // they're served as plain cacheable static files — no token, no DB, no JWT work per chunk.
  // Registered after CORS so hls.js in the admin panel can fetch them cross-origin. In
  // production nginx/CDN should serve this path instead (set HLS_SEGMENT_BASE_URL).
  const hlsDir = join(process.cwd(), 'uploads', 'hls');
  const hlsKeysDir = join(process.cwd(), 'storage', 'hls_keys');
  // /<videoId>/enc_00000.ts (single quality) or /<videoId>/<720p>/enc_00000.ts (multi-quality)
  const ENCRYPTED_SEGMENT = /^\/([\w-]+)\/(?:\d{3,4}p\/)?enc_\d+\.ts$/;
  app.use(
    '/hls-seg',
    (req: express.Request, res: express.Response, next: express.NextFunction) => {
      const match = req.path.match(ENCRYPTED_SEGMENT);
      // Only encrypted segments of videos that actually have a key — never plain legacy chunks.
      if (!match || !existsSync(join(hlsKeysDir, `${match[1]}.key`))) return res.status(404).end();
      next();
    },
    r2HlsSegments(app.get(R2Service), hlsDir), // [r2] chunks moved to the bucket
    express.static(hlsDir, { index: false, fallthrough: false, immutable: true, maxAge: '365d' }),
  );

  // Global validation pipe
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    transform: true,
  }));

  // Port configuration
  const port = process.env.PORT || 5001;
  await app.listen(port);
  console.log(`🚀 NestJS Backend listening on port ${port}`);
}
bootstrap();
// Refreshed batch-materials upload routes

