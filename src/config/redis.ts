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
    (config.features.useBackgroundJobs || config.env === 'production' || config.env === 'staging' || process.env.APP_ENV === 'staging');

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

// Throttle cache failure logs to prevent log flooding during outages/quota exhaustion
let lastLogErrorTime = 0;
const logCacheError = (operation: string, error: unknown): void => {
    const now = Date.now();
    if (now - lastLogErrorTime > 60000) {
        lastLogErrorTime = now;
        const msg = error instanceof Error ? error.message : String(error);
        console.warn(`[CacheService] Redis ${operation} failed (falling back to database): ${msg}`);
    }
};

export const cacheService = {
    async get<T>(key: string): Promise<T | null> {
        if (!config.features.useRedisCache) return null;
        try {
            if (upstashRedis) {
                const data = await upstashRedis.get<T>(key);
                if (data === null || data === undefined) return null;
                if (typeof data === 'string') {
                    try {
                        return JSON.parse(data) as T;
                    } catch {
                        return data as unknown as T;
                    }
                }
                return data;
            }
            if (ioRedis && ioRedis.status === 'ready') {
                const raw = await ioRedis.get(key);
                if (!raw) return null;
                return JSON.parse(raw) as T;
            }
            return null;
        } catch (error) {
            logCacheError(`get(${key})`, error);
            return null;
        }
    },

    async set<T>(key: string, data: T, ttl: number = DEFAULT_TTL): Promise<void> {
        if (!config.features.useRedisCache) return;
        try {
            const serialized = JSON.stringify(data);
            if (upstashRedis) {
                await upstashRedis.set(key, serialized, { ex: ttl });
                return;
            }
            if (ioRedis && ioRedis.status === 'ready') {
                await ioRedis.set(key, serialized, 'EX', ttl);
            }
        } catch (error) {
            logCacheError(`set(${key})`, error);
        }
    },

    async del(key: string): Promise<void> {
        if (!config.features.useRedisCache) return;
        try {
            if (upstashRedis) {
                await upstashRedis.del(key);
                return;
            }
            if (ioRedis && ioRedis.status === 'ready') {
                await ioRedis.del(key);
            }
        } catch (error) {
            logCacheError(`del(${key})`, error);
        }
    },

    async invalidatePattern(pattern: string): Promise<void> {
        if (!config.features.useRedisCache) return;
        try {
            if (upstashRedis) {
                let cursor = '0';
                do {
                    const result = await upstashRedis.scan(Number(cursor), { match: pattern, count: 100 });
                    cursor = String(result[0]);
                    const keys = result[1];
                    if (keys.length > 0) {
                        await upstashRedis.del(...keys);
                    }
                } while (cursor !== '0');
                return;
            }
            if (ioRedis && ioRedis.status === 'ready') {
                let cursor = '0';
                do {
                    const [nextCursor, keys] = await ioRedis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
                    cursor = nextCursor;
                    if (keys.length > 0) {
                        await ioRedis.del(...keys);
                    }
                } while (cursor !== '0');
            }
        } catch (error) {
            logCacheError(`invalidatePattern(${pattern})`, error);
        }
    },
};

// Cache keys helper with namespace prefixing for staging isolation
const keyPrefix = process.env.REDIS_KEY_PREFIX || (process.env.APP_ENV === 'staging' ? 'staging:' : '');

export const cacheKeys = {
    creatorPage: (slug: string = '') => `${keyPrefix}page:${(slug || '').toLowerCase()}`,
    creatorFeed: (slug: string = '', type: string = 'all', limit: number = 10) => `${keyPrefix}feed:${(slug || '').toLowerCase()}:${type}:${limit}`,
    creatorFeedPattern: (slug: string = '') => `${keyPrefix}feed:${(slug || '').toLowerCase()}:*`,
    creatorTiers: (creatorId: string) => `${keyPrefix}tiers:${creatorId}`,
    postFeed: (pageId: string, cursor?: string) => `${keyPrefix}posts:${pageId}:${cursor || 'first'}`,
    userSession: (userId: string) => `${keyPrefix}session:${userId}`,
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
