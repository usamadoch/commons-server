import { Queue, Worker, Job } from 'bullmq';
import config from '../config/index.js';
import { logger } from '../config/logger.js';

// Queue names
export const QUEUE_NAMES = {
    NOTIFICATIONS: 'notifications',
    ANALYTICS: 'analytics',
    MEDIA_CLEANUP: 'media_cleanup',
    EMAIL: 'email',
} as const;

// Job types
export interface NotificationJobData {
    type: 'new_member' | 'new_comment' | 'new_message' | 'post_liked' | 'new_post' | 'creator_went_live' | 'comment_reply';
    /** For single-recipient notifications */
    recipientId?: string;
    /** For mass notifications (fan-out) */
    recipientIds?: string[];
    title: string;
    body: string;
    actionUrl?: string;
    actionLabel?: string;
    imageUrl?: string | null;
    metadata?: Record<string, unknown>;
}

export interface EmailJobData {
    to: string;
    template: string;
    data: Record<string, unknown>;
}

export interface AnalyticsJobData {
    type: 'aggregate_daily' | 'aggregate_weekly' | 'update_post_stats';
    data: Record<string, unknown>;
}

export interface MediaCleanupJobData {
    type: 'image' | 'video';
    publicId?: string; // for Cloudinary
    muxAssetId?: string; // for Mux
}

// Queue instances
let notificationQueue: Queue<NotificationJobData> | null = null;
let analyticsQueue: Queue<AnalyticsJobData> | null = null;
let mediaCleanupQueue: Queue<MediaCleanupJobData> | null = null;
let emailQueue: Queue<EmailJobData> | null = null;

import { ioRedis } from '../config/redis.js';

// BullMQ queue prefix for staging/multi-environment isolation
export const QUEUE_PREFIX = process.env.REDIS_QUEUE_PREFIX || (process.env.APP_ENV === 'staging' ? 'staging' : undefined);

// Initialize queues
export const initializeQueues = (): void => {
    if (!config.features.useBackgroundJobs) {
        logger.info('Background jobs disabled, skipping queue initialization');
        return;
    }

    if (!ioRedis) {
        logger.warn('No Redis URL configured, background jobs will not run');
        return;
    }

    notificationQueue = new Queue<NotificationJobData>(QUEUE_NAMES.NOTIFICATIONS, {
        connection: ioRedis as any,
        prefix: QUEUE_PREFIX,
        defaultJobOptions: {
            removeOnComplete: 100,
            removeOnFail: 50,
            attempts: 3,
            backoff: {
                type: 'exponential',
                delay: 1000,
            },
        },
    });

    analyticsQueue = new Queue<AnalyticsJobData>(QUEUE_NAMES.ANALYTICS, {
        connection: ioRedis as any,
        prefix: QUEUE_PREFIX,
        defaultJobOptions: {
            removeOnComplete: 50,
            removeOnFail: 10,
            attempts: 2,
        },
    });

    mediaCleanupQueue = new Queue<MediaCleanupJobData>(QUEUE_NAMES.MEDIA_CLEANUP, {
        connection: ioRedis as any,
        prefix: QUEUE_PREFIX,
        defaultJobOptions: {
            removeOnComplete: 100, // Keep last 100 successful jobs
            removeOnFail: 500,    // Keep last 500 failed jobs for debugging
            attempts: 5,          // Retry up to 5 times for transient Cloudinary errors
            backoff: {
                type: 'exponential',
                delay: 2000,
            },
        },
    });

    emailQueue = new Queue<EmailJobData>(QUEUE_NAMES.EMAIL, {
        connection: ioRedis as any,
        prefix: QUEUE_PREFIX,
        defaultJobOptions: {
            removeOnComplete: 100,
            removeOnFail: 50,
            attempts: 3,
            backoff: {
                type: 'exponential',
                delay: 2000,
            },
        },
    });

    logger.info('BullMQ queues initialized', { prefix: QUEUE_PREFIX || 'default' });
};

// Get queue instances
export const getNotificationQueue = (): Queue<NotificationJobData> | null => notificationQueue;
export const getAnalyticsQueue = (): Queue<AnalyticsJobData> | null => analyticsQueue;
export const getMediaCleanupQueue = (): Queue<MediaCleanupJobData> | null => mediaCleanupQueue;
export const getEmailQueue = (): Queue<EmailJobData> | null => emailQueue;

// Add notification job
export const addNotificationJob = async (data: NotificationJobData): Promise<Job<NotificationJobData> | null> => {
    if (!notificationQueue) {
        // Fallback: process synchronously if queues not available
        logger.debug('Queue not available, notification will be created synchronously');
        return null;
    }

    return notificationQueue.add(`notification:${data.type}`, data);
};

// Add analytics job
export const addAnalyticsJob = async (data: AnalyticsJobData): Promise<Job<AnalyticsJobData> | null> => {
    if (!analyticsQueue) {
        return null;
    }

    return analyticsQueue.add(`analytics:${data.type}`, data);
};

// Add media cleanup job
export const addMediaCleanupJob = async (data: MediaCleanupJobData): Promise<Job<MediaCleanupJobData> | null> => {
    if (!mediaCleanupQueue) {
        // Fallback or log if no queue
        logger.warn('Media cleanup queue not available, asset may be orphaned');
        return null;
    }

    return mediaCleanupQueue.add('media:cleanup', data);
};

// Add email job
export const addEmailJob = async (data: EmailJobData): Promise<Job<EmailJobData> | null> => {
    if (!emailQueue) {
        logger.debug('Email queue not available, skipping email job');
        return null;
    }

    return emailQueue.add(`email:${data.template}`, data);
};

// Close queues gracefully
export const closeQueues = async (): Promise<void> => {
    const closePromises: Promise<void>[] = [];

    if (notificationQueue) {
        closePromises.push(notificationQueue.close());
    }
    if (analyticsQueue) {
        closePromises.push(analyticsQueue.close());
    }
    if (mediaCleanupQueue) {
        closePromises.push(mediaCleanupQueue.close());
    }
    if (emailQueue) {
        closePromises.push(emailQueue.close());
    }

    await Promise.all(closePromises);
    logger.info('BullMQ queues closed');
};

export { Queue, Worker, Job };
