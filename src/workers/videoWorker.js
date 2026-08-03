/**
 * videoWorker.js
 * Standalone BullMQ worker process for video processing.
 * Run with: node workers/videoWorker.js (or via npm run worker)
 * 
 * This process pulls jobs from the Redis queue, triggers the FastAPI
 * Python FFmpeg transcoder, polls MongoDB for progress updates, and completes
 * when the transcode webhook marks the media as ready.
 */
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)) });

import { Worker, QueueEvents } from 'bullmq';
import { redisConnection } from '../queues/videoQueue.js';
import mongoose from 'mongoose';
import axios from 'axios';
import fs from 'fs';
import Media from '../models/Media.js';

// ── Connect to DB ────────────────────────────────────────────────────────────
const connectDB = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ [Worker] MongoDB connected');
    } catch (err) {
        console.error('❌ [Worker] MongoDB connection failed:', err.message);
        process.exit(1);
    }
};

await connectDB();

// ── Worker Definition ────────────────────────────────────────────────────────
const CONCURRENCY = parseInt(process.env.VIDEO_WORKER_CONCURRENCY || '2');
const PYTHON_SERVICE_URL = process.env.PYTHON_AI_SERVICE_URL || 'http://localhost:8000';
const PYTHON_TIMEOUT_MS = parseInt(process.env.PYTHON_TIMEOUT_MS || '7200000'); // 2hr default
const POLL_INTERVAL_MS = 5000; // Poll DB every 5s

console.log(`🚀 [Worker] Starting with concurrency=${CONCURRENCY}`);

const cleanupSourceFile = async (inputPath) => {
    if (!inputPath) return;

    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            if (fs.existsSync(inputPath)) {
                await fs.promises.unlink(inputPath);
                console.log(`🧹 [Worker] Deleted source file: ${inputPath}`);
            }
            return;
        } catch (err) {
            if (attempt === 3) {
                console.warn(`⚠️  [Worker] Could not delete source file ${inputPath}: ${err.message}`);
                return;
            }
            await new Promise(resolve => setTimeout(resolve, attempt * 1000));
        }
    }
};

const worker = new Worker(
    'video-processing',
    async (job) => {
        const { videoId, mediaId, inputPath, outputDir } = job.data;
        console.log(`\n⚙️  [Worker] Processing job ${job.id} | videoId: ${videoId}`);

        // Mark as processing in DB
        await Media.findByIdAndUpdate(mediaId, {
            status: 'processing',
            processingStartedAt: new Date(),
            jobId: job.id
        });

        await job.updateProgress(1);

        try {
            // 1. Call Python service to start background transcoding
            const response = await axios.post(
                `${PYTHON_SERVICE_URL}/process-video`,
                {
                    input_path: inputPath,
                    output_dir: outputDir,
                    video_id: videoId,
                    media_id: mediaId.toString(),
                },
                {
                    timeout: 15000, // 15s to accept the job request
                    headers: { 'X-Worker-Job-Id': job.id }
                }
            );

            if (!response.data?.success) {
                throw new Error(response.data?.message || 'Python service failed to accept job');
            }

            console.log(`⚙️  [Worker] Job accepted by Python service. Polling database for status updates...`);

            // 2. Poll the MongoDB Media document until status is 'ready' or 'failed'
            const startTime = Date.now();
            let isDone = false;

            while (!isDone) {
                await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));

                const media = await Media.findById(mediaId);
                if (!media) {
                    throw new Error('Media document was deleted during processing');
                }

                if (media.status === 'ready') {
                    isDone = true;
                    await job.updateProgress(100);
                    await cleanupSourceFile(inputPath);
                    console.log(`✅ [Worker] Job ${job.id} completed successfully for ${videoId}`);
                    return { success: true, videoId };
                }

                if (media.status === 'failed') {
                    throw new Error(media.failureReason || 'FastAPI transcoding failed');
                }

                // Update BullMQ job progress
                const progress = media.processingProgress || 0;
                await job.updateProgress(progress);
                console.log(`⏳ [Worker] Job ${job.id} progress: ${progress}%`);

                // Timeout guard
                if (Date.now() - startTime > PYTHON_TIMEOUT_MS) {
                    throw new Error(`Processing timed out after ${PYTHON_TIMEOUT_MS / 1000} seconds`);
                }
            }

        } catch (err) {
            console.error(`❌ [Worker] Job ${job.id} failed for ${videoId}:`, err.message);

            // Ensure status is marked failed in DB
            await Media.findByIdAndUpdate(mediaId, {
                status: 'failed',
                failureReason: err.message?.substring(0, 500)
            });

            throw err; // Fail BullMQ job so it can trigger retries
        }
    },
    {
        connection: redisConnection,
        concurrency: CONCURRENCY,
        stalledInterval: 60000, // Extend to 60s for video transcode
        maxStalledCount: 2,
    }
);

// ── Event Listeners ──────────────────────────────────────────────────────────
worker.on('completed', (job) => {
    console.log(`✅ [Worker] Job ${job.id} completed successfully`);
});

worker.on('failed', (job, err) => {
    if (job && job.attemptsMade >= job.opts.attempts) {
        console.error(`💀 [Worker] Job ${job.id} permanently failed after ${job.attemptsMade} attempts:`, err.message);
    } else if (job) {
        console.warn(`⚠️  [Worker] Job ${job.id} failed (attempt ${job.attemptsMade}), will retry:`, err.message);
    } else {
        console.error(`❌ [Worker] Job failed:`, err.message);
    }
});

worker.on('stalled', (jobId) => {
    console.warn(`⚠️  [Worker] Job ${jobId} stalled — will be reclaimed`);
});

worker.on('error', (err) => {
    console.error('❌ [Worker] Worker error:', err.message);
});

// ── Queue Events (for logging) ───────────────────────────────────────────────
const queueEvents = new QueueEvents('video-processing', { connection: redisConnection });

queueEvents.on('waiting', ({ jobId }) => {
    console.log(`⏳ [Queue] Job ${jobId} waiting`);
});

// ── Graceful Shutdown ────────────────────────────────────────────────────────
const shutdown = async (signal) => {
    console.log(`\n🛑 [Worker] Received ${signal} — shutting down gracefully...`);
    await worker.close();
    await mongoose.disconnect();
    process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

console.log('Worker is active. Waiting for jobs...');
