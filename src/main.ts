import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { AppModule } from './app.module';
import * as dotenv from 'dotenv';
import * as express from 'express';
import { join } from 'path';
import { MongoIdInterceptor } from './common/interceptors/mongo-id.interceptor';
import { MediaUrlSigningInterceptor } from './media-access/media-url-signing.interceptor';

dotenv.config();

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Standard HTTP-header hardening (clickjacking, MIME sniffing, etc.). CSP disabled: this API
  // serves HLS playlists/segments and uploaded media directly, and the default CSP would block them.
  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: false }));

  // Global prefix
  app.setGlobalPrefix('api');

  // Register Global Interceptor for MongoDB compatibility
  app.useGlobalInterceptors(new MongoIdInterceptor(), app.get(MediaUrlSigningInterceptor));

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

