import { Redis as UpstashRedis } from '@upstash/redis';
import { Redis as IORedis } from 'ioredis';
import config from './index.js';

// Upstash Redis client (REST API - for cache operations)
export const upstashRedis = config.redis.url && config.redis.token
    ? new UpstashRedis({
        url: config.redis.url,
        token: config.redis.token,
    })
    : null;

// IORedis client (TCP - for BullMQ and rate limiting)
// Only create if explicitly configured - otherwise use in-memory store
// IORedis client (TCP - for BullMQ and rate limiting)
// Only create if explicitly configured AND (background jobs enabled OR production environment)
const shouldConnectToRedis =
    config.redis.ioRedisUrl &&
    (config.features.useBackgroundJobs || config.env === 'production');

export const ioRedis = shouldConnectToRedis
    ? new IORedis(config.redis.ioRedisUrl, {
        maxRetriesPerRequest: null, // Required for BullMQ
        enableReadyCheck: false,
        lazyConnect: true,
        family: 4, // Force IPv4 to prevent EAI_AGAIN DNS timeouts on some networks
        // Automatically enable TLS if URL starts with rediss://
        tls: config.redis.ioRedisUrl.startsWith('rediss://') ? {
            rejectUnauthorized: false // Often needed for self-signed certificates or some cloud providers
        } : undefined
    })
    : null;

// Connection event handlers (only if ioRedis exists)
if (ioRedis) {
    ioRedis.on('connect', () => {
        console.log('✅ IORedis connected');
    });

    ioRedis.on('error', (err: Error) => {
        console.error('❌ IORedis error:', err.message);
    });
}

// Cache service utilities
const DEFAULT_TTL = 300; // 5 minutes

export const cacheService = {
    async get<T>(key: string): Promise<T | null> {
        try {
            if (!config.features.useRedisCache || !upstashRedis) return null;
            const data = await upstashRedis.get<T>(key);
            return data;
        } catch (error) {
            console.error('Cache get error:', error);
            return null;
        }
    },

    async set<T>(key: string, data: T, ttl: number = DEFAULT_TTL): Promise<void> {
        try {
            if (!config.features.useRedisCache || !upstashRedis) return;
            await upstashRedis.setex(key, ttl, JSON.stringify(data));
        } catch (error) {
            console.error('Cache set error:', error);
        }
    },

    async del(key: string): Promise<void> {
        try {
            if (!config.features.useRedisCache || !upstashRedis) return;
            await upstashRedis.del(key);
        } catch (error) {
            console.error('Cache del error:', error);
        }
    },

    async invalidatePattern(pattern: string): Promise<void> {
        try {
            if (!config.features.useRedisCache || !upstashRedis) return;
            let cursor = '0';
            do {
                const result = await upstashRedis.scan(Number(cursor), { match: pattern, count: 100 });
                cursor = String(result[0]);
                const keys = result[1];
                if (keys.length > 0) {
                    await upstashRedis.del(...keys);
                }
            } while (cursor !== '0');
        } catch (error) {
            console.error('Cache invalidate error:', error);
        }
    },
};

// Cache keys helper
export const cacheKeys = {
    creatorPage: (slug: string) => `page:${slug}`,
    postFeed: (pageId: string, cursor?: string) => `posts:${pageId}:${cursor || 'first'}`,
    userSession: (userId: string) => `session:${userId}`,
};

// Graceful shutdown
export const closeRedisConnections = async (): Promise<void> => {
    try {
        if (ioRedis) {
            await ioRedis.quit();
            console.log('Redis connections closed');
        }
    } catch (error) {
        console.error('Error closing Redis connections:', error);
    }
};

export default upstashRedis;
