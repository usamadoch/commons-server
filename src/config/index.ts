import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

interface Config {
    env: string;
    port: number;
    clientUrl: string;
    mongodb: {
        uri: string;
    };
    jwt: {
        accessSecret: string;
        refreshSecret: string;
        accessExpiry: string;
        refreshExpiry: string;
    };
    google: {
        clientId: string;
        clientSecret: string;
        callbackUrl: string;
    };
    upload: {
        dir: string;
        maxFileSize: number;
    };
    cookie: {
        secret: string;
    };
    redis: {
        url: string;
        token: string;
        ioRedisUrl: string;
    };
    features: {
        useRedisCache: boolean;
        useBackgroundJobs: boolean;
        enableAuditLogs: boolean;
        emailEnabled: boolean;
    };
    mux: {
        tokenId: string;
        tokenSecret: string;
        webhookSecret: string;
    };
    cloudinary: {
        cloudName: string;
        apiKey: string;
        apiSecret: string;
    };
}

import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const config: Config = {
    env: process.env.NODE_ENV || 'development',
    port: parseInt(process.env.PORT || '5000', 10),
    clientUrl: process.env.CLIENT_URL || 'http://localhost:3000',
    mongodb: {
        uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/patreon_mvp',
    },
    jwt: {
        accessSecret: process.env.JWT_ACCESS_SECRET || 'dev_access_secret',
        refreshSecret: process.env.JWT_REFRESH_SECRET || 'dev_refresh_secret',
        accessExpiry: process.env.JWT_ACCESS_EXPIRY || '15m',
        refreshExpiry: process.env.JWT_REFRESH_EXPIRY || '7d',
    },
    google: {
        clientId: process.env.GOOGLE_CLIENT_ID || '',
        clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
        callbackUrl: process.env.GOOGLE_CALLBACK_URL || 'http://localhost:5000/auth/google/callback',
    },
    upload: {
        dir: process.env.UPLOAD_DIR || path.join(__dirname, '../../uploads'),
        maxFileSize: parseInt(process.env.MAX_FILE_SIZE || '10485760', 10),
    },
    cookie: {
        secret: process.env.COOKIE_SECRET || 'dev_cookie_secret',
    },
    redis: {
        url: process.env.UPSTASH_REDIS_REST_URL || '',
        token: process.env.UPSTASH_REDIS_REST_TOKEN || '',
        ioRedisUrl: process.env.UPSTASH_REDIS_URL || '',
    },
    features: {
        useRedisCache: process.env.FEATURE_REDIS_CACHE === 'true',
        useBackgroundJobs: process.env.FEATURE_BACKGROUND_JOBS === 'true',
        enableAuditLogs: process.env.FEATURE_AUDIT_LOGS !== 'false', // default on
        emailEnabled: process.env.EMAIL_ENABLED === 'true', // default off — scaffold only, no real sends
    },
    mux: {
        tokenId: process.env.MUX_TOKEN_ID || '',
        tokenSecret: process.env.MUX_TOKEN_SECRET || '',
        webhookSecret: process.env.MUX_WEBHOOK_SECRET || '',
    },
    cloudinary: {
        cloudName: process.env.CLOUDINARY_CLOUD_NAME || '',
        apiKey: process.env.CLOUDINARY_API_KEY || '',
        apiSecret: process.env.CLOUDINARY_API_SECRET || '',
    }
};

export default config;
