import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { VideoProcessor } from './video.processor';
import { VideoQueueService } from './video-queue.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [
    PrismaModule,
    BullModule.forRoot({
      redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
      },
    }),
    BullModule.registerQueue({
      name: 'video-transcoding',
    }),
  ],
  providers: [VideoProcessor, VideoQueueService],
  exports: [BullModule, VideoQueueService],
})
export class QueuesModule {}
