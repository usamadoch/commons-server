





import { Worker, Job } from 'bullmq';
import { Server } from 'socket.io';
import config from '../../config/index.js';
import { logger } from '../../config/logger.js';
import { ioRedis } from '../../config/redis.js';
import { QUEUE_NAMES, NotificationJobData } from '../queues.js';
import { NotificationService } from '../../services/notificationService.js';

let worker: Worker<NotificationJobData> | null = null;
let ioInstance: Server | undefined = undefined;

/**
 * Process notification jobs
 */
const processNotification = async (job: Job<NotificationJobData>): Promise<void> => {
    const { type, recipientId, title, body, actionUrl, actionLabel, metadata } = job.data;

    logger.debug('Processing notification job', { jobId: job.id, type, recipientId });

    try {
        await NotificationService.sendNotification(
            recipientId,
            type,
            title,
            body,
            {
                actionUrl: actionUrl || '/', // Fallback to root if missing, though model requires it
                actionLabel,
                metadata,
                io: ioInstance
            }
        );

        logger.info('Notification processed successfully', { jobId: job.id, type, recipientId });
    } catch (error) {
        logger.error('Failed to process notification job', { jobId: job.id, error });
        throw error; // Re-throw to trigger retry
    }
};

/**
 * Start the notification worker
 */
export const startNotificationWorker = (io?: Server): void => {
    if (io) {
        ioInstance = io;
    }

    if (!config.features.useBackgroundJobs) {
        logger.info('Background jobs disabled, notification worker not started');
        return;
    }

    if (!ioRedis) {
        logger.warn('No Redis configured, notification worker not started');
        return;
    }

    worker = new Worker<NotificationJobData>(
        QUEUE_NAMES.NOTIFICATIONS,
        processNotification,
        {
            connection: ioRedis as any,
            concurrency: 5,
        }
    );

    worker.on('completed', (job) => {
        logger.debug('Notification job completed', { jobId: job.id });
    });

    worker.on('failed', (job, error) => {
        logger.error('Notification job failed', { jobId: job?.id, error: error.message });
    });

    worker.on('error', (error) => {
        logger.error('Notification worker error', { error: error.message });
    });

    logger.info('Notification worker started');
};

/**
 * Stop the notification worker
 */
export const stopNotificationWorker = async (): Promise<void> => {
    if (worker) {
        await worker.close();
        worker = null;
        logger.info('Notification worker stopped');
    }
};

export default { startNotificationWorker, stopNotificationWorker };
