import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';
import { HlsSecurityService } from './hls-security.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [
    PrismaModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET || '48fbc47de83da5bedd6f1ae21c176f031a3830372b3b61a876cc4376ca26f6ae1ed4b125c418689e741cd037717b5b3a7',
    }),
  ],
  controllers: [MediaController],
  providers: [MediaService, HlsSecurityService],
  exports: [MediaService, HlsSecurityService],
})
export class MediaModule {}
