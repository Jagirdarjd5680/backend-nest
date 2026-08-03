import { Module } from '@nestjs/common';
import { VideoReviewsController } from './video-reviews.controller';
import { VideoReviewsService } from './video-reviews.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [VideoReviewsController],
  providers: [VideoReviewsService],
  exports: [VideoReviewsService],
})
export class VideoReviewsModule {}
