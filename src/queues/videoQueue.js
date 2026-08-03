/**
 * videoQueue.js
 * Production-grade BullMQ queue configuration for background video processing.
 * Backed by Redis to support high concurrency, retries, and worker scaling.
 */
import { Queue } from 'bullmq';
import IORedis from 'ioredis';

// Redis connection specifically for BullMQ (maxRetriesPerRequest MUST be null)
export const redisConnection = process.env.REDIS_URL
    ? new IORedis(process.env.REDIS_URL, {
        maxRetriesPerRequest: null,
      })
    : new IORedis({
        host: process.env.REDIS_HOST     || '127.0.0.1',
        port: parseInt(process.env.REDIS_PORT || '6379'),
        password: process.env.REDIS_PASSWORD || undefined,
        maxRetriesPerRequest: null,
      });

// Configure the video processing queue
const videoQueue = new Queue('video-processing', {
    connection: redisConnection,
    defaultJobOptions: {
        attempts: 3, // Retry failed jobs up to 3 times
        backoff: {
            type: 'exponential',
            delay: 10000, // Wait 10s, 20s, 40s...
        },
        removeOnComplete: true, // Automatically delete job details on success to save Redis space
        removeOnFail: false,    // Keep failed jobs for manual inspection / retry
    }
});

/**
 * Add a video processing job to the Redis queue.
 * @param {object} data - Job payload containing videoId, mediaId, inputPath, and outputDir
 * @returns {Promise<string>} The unique ID of the enqueued job
 */
export const enqueueVideoJob = async (data) => {
    const job = await videoQueue.add('transcode', data);
    console.log(`\n📥 [Video Queue] Enqueued video job ${job.id} for videoId: ${data.videoId}`);
    return job.id;
};

