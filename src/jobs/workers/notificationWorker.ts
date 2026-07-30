import { Worker, Job } from 'bullmq';
import { Server } from 'socket.io';
import config from '../../config/index.js';
import { logger } from '../../config/logger.js';
import { ioRedis } from '../../config/redis.js';
import { QUEUE_NAMES, NotificationJobData, addEmailJob } from '../queues.js';
import { NotificationService } from '../../services/notificationService.js';
import { userRepository } from '../../repositories/userRepository.js';

let worker: Worker<NotificationJobData> | null = null;
let ioInstance: Server | undefined = undefined;

/**
 * Process notification jobs — both single-recipient and mass fan-out.
 * Also enqueues email jobs for types that support email (currently `new_post`),
 * gated by `EMAIL_ENABLED` env var and per-user email preferences.
 */
const processNotification = async (job: Job<NotificationJobData>): Promise<void> => {
    const { type, recipientId, recipientIds, title, body, actionUrl, actionLabel, imageUrl, metadata } = job.data;

    logger.debug('Processing notification job', { jobId: job.id, type, recipientId, recipientCount: recipientIds?.length });

    try {
        if (recipientIds && recipientIds.length > 0) {
            // Mass notification path
            const shouldSendPush = metadata?.notifyPush !== false;

            if (shouldSendPush) {
                await NotificationService.sendMassNotification(
                    recipientIds,
                    type,
                    title,
                    body,
                    {
                        actionUrl: actionUrl || '/',
                        actionLabel,
                        imageUrl,
                        metadata,
                        io: ioInstance
                    }
                );
            }

            // Enqueue email jobs for eligible types
            const isNewPostEmail = type === 'new_post' && config.features.emailEnabled;
            const isLiveEmail = type === 'creator_went_live' && config.features.emailEnabled && metadata?.notifyEmail === true;

            if (isNewPostEmail || isLiveEmail) {
                const users = await userRepository.find(
                    { _id: { $in: recipientIds } },
                    '_id email notificationPreferences'
                );

                for (const user of users as any[]) {
                    const emailPrefs = user.notificationPreferences?.email;
                    let shouldEmail = true;
                    
                    if (isNewPostEmail && emailPrefs?.newPosts === false) {
                        shouldEmail = false;
                    }

                    if (shouldEmail) {
                        await addEmailJob({
                            to: user.email,
                            template: 'new-post', // Re-using generic template since it takes title/body/url
                            data: { title, body, actionUrl: actionUrl || '/', ...metadata },
                        });
                    }
                }
            }
        } else if (recipientId) {
            // Single notification path
            await NotificationService.sendNotification(
                recipientId,
                type,
                title,
                body,
                {
                    actionUrl: actionUrl || '/',
                    actionLabel,
                    imageUrl,
                    metadata,
                    io: ioInstance
                }
            );
        } else {
            logger.warn('Notification job has no recipientId or recipientIds', { jobId: job.id });
        }

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
