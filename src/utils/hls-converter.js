import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import path from 'path';
import fs from 'fs';
import { exec } from 'child_process';

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

console.log('✅ [GOG SYSTEM] HLS Converter Module Loaded (20s chunks / ~2MB)!');

/**
 * Converts a video file to HLS chunks.
 * @param {string} inputPath - Path to the source video file.
 * @param {string} outputDir - Directory to store HLS chunks.
 * @param {string} videoId - Unique ID for the video.
 * @returns {Promise<string>} - Path to the .m3u8 playlist file.
 */
export const convertToHLS = async (inputPath, outputDir, videoId) => {
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    const playlistPath = path.join(outputDir, 'index.m3u8');
    const segmentPath = path.join(outputDir, 'segment_%03d.ts');

    // DEBUG: Using ffmpeg itself to log file info since ffprobe is missing
    exec(`ffmpeg -i "${inputPath}"`, (err, stdout, stderr) => {
        // Metadata is usually in stderr for ffmpeg
        const info = stderr || stdout;
        const hasAudio = info.toLowerCase().includes('audio:');
        if (hasAudio) {
            console.log('🎵 [Audio Debug] Audio stream DETECTED in source file.');
            const audioMatch = info.match(/Audio: ([^,]+),/);
            if (audioMatch) console.log(`👉 [Audio Info] Format: ${audioMatch[1]}`);
        } else {
            console.log('⚠️ [Audio Debug] NO AUDIO detected in source file!');
        }
    });

    return new Promise((resolve, reject) => {
        const startTime = Date.now();
        let lastLogTime = Date.now();

        ffmpeg(inputPath)
            .outputOptions([
                '-map 0:v:0',         // Map first video stream
                '-map 0:a:0?',        // Map first audio stream (optional)
                '-c:v libx264',       // Standard HLS video codec
                '-pix_fmt yuv420p',   // Ensure compatibility
                '-profile:v baseline',
                '-level 3.0',
                '-start_number 0',
                '-hls_time 20',      // ~2 MB per chunk (20 seconds)
                '-hls_list_size 0',
                '-f hls',
                '-preset ultrafast',  // Use maximum speed
                '-threads 0',         // Use all available CPU cores
                '-tune fastdecode',   // Optimize for fast playback
                '-c:a aac',           // Force AAC for HLS compatibility
                '-b:a 128k',          // Audio bitrate
                '-ar 44100',          // Standard sample rate
                '-ac 2'               // Stereo
            ])
            .output(playlistPath)
            .on('progress', (progress) => {
                const now = Date.now();
                // Print progress every 3 seconds to avoid flooding console
                if (now - lastLogTime > 3000) {
                    const pct = progress.percent ? progress.percent.toFixed(1) + '%' : `${progress.frames} frames`;
                    console.log(`⏳ [HLS Processing] Converting... ${pct} done ⚙️`);
                    lastLogTime = now;
                }
            })
            .on('end', () => {
                const timeTakenSec = ((Date.now() - startTime) / 1000).toFixed(1);
                console.log(`✅ [SUCCESS] Video uploaded and converted! 🎉`);
                console.log(`⏱️ Time taken: ${timeTakenSec} seconds 🚀`);
                console.log(`📂 Saved at: ${playlistPath}`);
                // Delete the original file after conversion to save space
                if (fs.existsSync(inputPath)) {
                    fs.unlinkSync(inputPath); 
                }
                resolve(playlistPath);
            })
            .on('error', (err) => {
                console.error(`HLS conversion error: ${err.message}`);
                reject(err);
            })
            .run();
    });
};
