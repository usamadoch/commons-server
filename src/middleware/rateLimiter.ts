import rateLimit, { RateLimitRequestHandler } from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';

import { ioRedis } from '../config/redis.js';
import config from '../config/index.js';
import { AuthenticatedRequest } from '../types/index.js';

// Rate limit configurations
interface RateLimitConfig {
    windowMs: number;
    max: number;
    message: string;
}

const rateLimitConfigs: Record<string, RateLimitConfig> = {
    login: {
        windowMs: 15 * 60 * 1000, // 15 minutes
        max: 5,
        message: 'Too many login attempts, please try again after 15 minutes',
    },
    signup: {
        windowMs: 60 * 60 * 1000, // 1 hour
        max: 3,
        message: 'Too many signup attempts, please try again later',
    },
    createPost: {
        windowMs: 60 * 60 * 1000, // 1 hour
        max: 30,
        message: 'Too many posts created, please slow down',
    },
    joinMembership: {
        windowMs: 60 * 60 * 1000, // 1 hour
        max: 5,
        message: 'Too many member requests, please slow down',
    },
    sendMessage: {
        windowMs: 60 * 1000, // 1 minute
        max: 30,
        message: 'Too many messages, please slow down',
    },
    upload: {
        windowMs: 60 * 60 * 1000, // 1 hour
        max: 50,
        message: 'Too many uploads, please try again later',
    },
    api: {
        windowMs: 60 * 1000, // 1 minute
        max: 100,
        message: 'Too many requests, please slow down',
    },
    postView: {
        windowMs: 60 * 1000, // 1 minute
        max: 30, // 30 views per minute per IP/user
        message: 'Too many view requests, please slow down',
    },
};

// Create rate limiter with optional Redis store
const createRateLimiter = (configKey: string): RateLimitRequestHandler => {
    const conf = rateLimitConfigs[configKey] || rateLimitConfigs.api;

    const isStaging = process.env.APP_ENV === 'staging' || process.env.RATE_LIMIT_PROFILE === 'staging';
    const isProdDb = config.mongodb.uri.includes('commons_prod');
    // Safety guard: Staging rate-limit relaxation is strictly forbidden when connected to commons_prod
    const safeStaging = isStaging && !isProdDb;

    // Distinguish development vs deployed (production or staging)
    const isDev = process.env.NODE_ENV !== 'production' && !isStaging;

    let windowMs = conf.windowMs;
    let max = conf.max;

    if (isDev) {
        windowMs = 1000;
        max = 1000;  // High limits in local dev
    } else if (safeStaging) {
        // In safe staging, permit 20-VU concurrent performance testing for general endpoints
        // while preserving protection for auth, signup, and sensitive actions
        if (configKey === 'api') {
            max = parseInt(process.env.STAGING_RATE_LIMIT_API_MAX || '3000', 10);
        } else if (configKey === 'postView') {
            max = parseInt(process.env.STAGING_RATE_LIMIT_POST_VIEW_MAX || '600', 10);
        }
    }

    const limiterOptions: Parameters<typeof rateLimit>[0] = {
        windowMs,
        max,
        standardHeaders: true,
        legacyHeaders: false,
        message: {
            success: false,
            error: {
                code: 'RATE_LIMITED',
                message: conf.message,
            },
        },
        // Use simple IP-based key generator to avoid validation issues
        keyGenerator: (req) => {
            const authReq = req as AuthenticatedRequest;
            if (authReq.user?._id) {
                return `user:${authReq.user._id.toString()}`;
            }
            return `ip:${req.ip || 'anonymous'}`;
        },
        // Disable all validation to avoid compatibility issues
        validate: false,
        // Skip OPTIONS requests (CORS preflight)
        skip: (req) => req.method === 'OPTIONS',
    };

    // Use Redis store if Redis is available (in production or staging)
    if (!isDev && config.redis.ioRedisUrl && ioRedis) {
        const redisClient = ioRedis; // Capture for closure
        const prefix = process.env.REDIS_KEY_PREFIX || (isStaging ? 'staging:' : '');
        try {
            limiterOptions.store = new RedisStore({
                sendCommand: async (...args: string[]): Promise<number | string> => {
                    const result = await redisClient.call(args[0], ...args.slice(1));
                    return result as number | string;
                },
                prefix: `${prefix}ratelimit:${configKey}:`,
            });
            // Crucial: allow requests to proceed if Redis store fails or hits quota limits
            limiterOptions.passOnStoreError = true;
        } catch (error) {
            console.warn('Failed to create Redis store for rate limiter, using memory store:', error);
        }
    }

    return rateLimit(limiterOptions);
};

// Export pre-configured rate limiters
export const loginLimiter = createRateLimiter('login');
export const signupLimiter = createRateLimiter('signup');
export const createPostLimiter = createRateLimiter('createPost');
export const joinMembershipLimiter = createRateLimiter('joinMembership');
export const sendMessageLimiter = createRateLimiter('sendMessage');
export const uploadLimiter = createRateLimiter('upload');
export const apiLimiter = createRateLimiter('api');
export const postViewLimiter = createRateLimiter('postView');

export default createRateLimiter;
