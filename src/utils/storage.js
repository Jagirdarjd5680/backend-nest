import { convertToHLS } from './hls-converter.js';
import Settings from '../models/Settings.js';
import fs from 'fs';
import path from 'path';

export const getActiveStorageSettings = async () => {
    const settings = await Settings.findOne();
    return settings?.storage || { activeProvider: 'local' };
};

/**
 * Uploads a file to the local storage and converts videos to HLS
 * @param {Object} file - Multer file object
 * @param {String} folder - Target folder name
 * @param {Boolean} background - Whether to convert in background
 */
export const uploadFile = async (file, folder = 'uploads', background = false) => {
    // Force local storage as requested
    const provider = 'local'; 

    const isVideo = file.mimetype?.startsWith('video/') || 
                    ['.mp4', '.mkv', '.mov', '.avi', '.flv', '.wmv'].some(ext => 
                        (file.originalname || '').toLowerCase().endsWith(ext)
                    );

    if (isVideo) {
        try {
            const videoId = `video_${Date.now()}_${Math.round(Math.random() * 1E9)}`;
            const outputDir = path.join(process.cwd(), 'uploads', 'hls');
            
            // Input path is where multer saved it
            const inputPath = file.path;
            
            if (background) {
                // Run conversion in BACKGROUND
                (async () => {
                    try {
                        await convertToHLS(inputPath, outputDir, videoId);
                        console.log(`✅ Background HLS conversion finished for: ${videoId}`);
                    } catch (err) {
                        console.error(`❌ Background HLS conversion failed for ${videoId}:`, err.message);
                    }
                })();
                // Return URL immediately
                return `/api/media/stream/${videoId}/index.m3u8`;
            } else {
                await convertToHLS(inputPath, outputDir, videoId);
                return `/api/media/stream/${videoId}/index.m3u8`;
            }
        } catch (error) {
            console.error('HLS conversion failed:', error.message);
            return `/api/media/file/${path.basename(file.path || file.filename)}`;
        }
    }

    // Default local storage for non-video files (Secure serving)
    return `/api/media/file/${path.basename(file.path || file.filename)}`;
};


/**
 * Tests connection to a storage provider (Simplified for local)
 */
export const testStorageConnection = async (provider, config) => {
    return { success: true, message: 'Local storage is active and secure.' };
};

/**
 * Deletes a file and its associated HLS folder if it's a video
 * @param {String} fileUrl - The URL of the file stored in DB
 */
export const deleteFile = async (fileUrl) => {
    try {
        if (!fileUrl) return;

        const uploadsDir = path.join(process.cwd(), 'uploads');
        const hlsDir = path.join(uploadsDir, 'hls');

        // Case 1: HLS Video (/api/media/stream/video_ID/index.m3u8)
        if (fileUrl.includes('/api/media/stream/')) {
            const videoIdMatch = fileUrl.match(/\/api\/media\/stream\/(video_[^\/]+)\//);
            if (videoIdMatch) {
                const videoId = videoIdMatch[1];
                const targetHlsDir = path.join(hlsDir, videoId);
                
                if (fs.existsSync(targetHlsDir)) {
                    fs.rmSync(targetHlsDir, { recursive: true, force: true });
                    console.log(`🗑️ Deleted HLS directory: ${videoId}`);
                }
            }
            return;
        } 
        
        // Case 2: Standard file serving with relative paths
        let relativePath = '';
        if (fileUrl.includes('/api/media/file/')) {
            relativePath = fileUrl.split('/api/media/file/')[1];
        } else if (fileUrl.includes('/uploads/')) {
            relativePath = fileUrl.split('/uploads/')[1];
        } else {
            relativePath = path.basename(fileUrl);
        }

        // Strip any query params or tokens from the URL (e.g. ?token=...)
        relativePath = relativePath.split('?')[0];

        // Replace forward slashes with system specific separator (OS friendly)
        const normalizedSubpath = relativePath.split('/').join(path.sep);
        const filePath = path.join(uploadsDir, normalizedSubpath);
        
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            console.log(`🗑️ Deleted physical file: ${normalizedSubpath}`);
        } else {
            console.warn(`⚠️ File not found on disk: ${filePath}`);
        }

    } catch (error) {
        console.error('❌ File Deletion Error:', error.message);
    }
};

