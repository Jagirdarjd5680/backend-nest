import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';

export interface VideoJobData {
  videoId: string;
  mediaId: string;
  inputPath: string;
  outputDir: string;
}

@Injectable()
export class VideoQueueService {
  private readonly logger = new Logger(VideoQueueService.name);

  constructor(@InjectQueue('video-transcoding') private readonly videoQueue: Queue) {}

  /**
   * Enqueue a video for background HLS transcoding
   */
  async enqueueVideoJob(data: VideoJobData): Promise<string> {
    const job = await this.videoQueue.add('transcode', data, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 10000,
      },
      removeOnComplete: true,
      removeOnFail: false,
    });

    this.logger.log(`📥 [VideoQueueService] Enqueued job ${job.id} for videoId: ${data.videoId}`);
    return String(job.id);
  }
}
