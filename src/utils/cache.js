/**
 * cache.js — Redis caching helper for Node.js backend
 * Provides simple get/set/del with JSON serialization and TTL support.
 */
import IORedis from 'ioredis';

const redisOptions = {
    maxRetriesPerRequest: 3,
    enableOfflineQueue: false,
};

const redis = process.env.REDIS_URL
    ? new IORedis(process.env.REDIS_URL, redisOptions)
    : new IORedis({
        host: process.env.REDIS_HOST     || '127.0.0.1',
        port: parseInt(process.env.REDIS_PORT || '6379'),
        password: process.env.REDIS_PASSWORD || undefined,
        ...redisOptions,
      });

redis.on('error', (err) => {
    // Don't crash on Redis unavailability — degrade gracefully
    if (!err.message.includes('ECONNREFUSED')) {
        console.error('❌ [Cache] Redis error:', err.message);
    }
});

/**
 * Get a cached value. Returns null if not found or Redis is unavailable.
 * @param {string} key
 * @returns {Promise<any|null>}
 */
export const cacheGet = async (key) => {
    try {
        const val = await redis.get(key);
        if (val === null) return null;
        return JSON.parse(val);
    } catch {
        return null;
    }
};

/**
 * Set a value in cache with optional TTL in seconds.
 * Silently fails if Redis is unavailable.
 * @param {string} key
 * @param {any} value
 * @param {number} [ttlSeconds]
 */
export const cacheSet = async (key, value, ttlSeconds) => {
    try {
        const serialized = JSON.stringify(value);
        if (ttlSeconds) {
            await redis.setex(key, ttlSeconds, serialized);
        } else {
            await redis.set(key, serialized);
        }
    } catch { /* graceful degradation */ }
};

/**
 * Delete a cache key (use on mutations).
 * @param {...string} keys
 */
export const cacheDel = async (...keys) => {
    try {
        if (keys.length > 0) await redis.del(...keys);
    } catch { /* graceful degradation */ }
};

export { redis };
