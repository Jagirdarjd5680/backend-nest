import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MediaAccessService } from './media-access.service';
import { MediaAccessController } from './media-access.controller';
import { MediaUrlSigningInterceptor } from './media-url-signing.interceptor';

@Module({
  imports: [
    // A dedicated secret/instance — deliberately NOT the same JwtModule.register()
    // call used for login JWTs (auth/session/chat), so a leaked media token can't
    // be replayed as a login session and a leaked login JWT can't mint media tokens.
    JwtModule.register({
      secret: process.env.MEDIA_TOKEN_SECRET || 'media-a1f9c3e7b2d84f6a9c1e5b7d3a8f2c6e-dev-only-change-in-prod',
    }),
  ],
  providers: [MediaAccessService, MediaUrlSigningInterceptor],
  controllers: [MediaAccessController],
  exports: [MediaAccessService, MediaUrlSigningInterceptor],
})
export class MediaAccessModule {}
