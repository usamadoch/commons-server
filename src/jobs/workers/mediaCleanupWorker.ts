import { Worker, Job } from 'bullmq';
import config from '../../config/index.js';
import { logger } from '../../config/logger.js';
import { ioRedis } from '../../config/redis.js';
import { QUEUE_NAMES, MediaCleanupJobData } from '../queues.js';
import { cloudinaryService } from '../../services/media/cloudinaryService.js';

let worker: Worker<MediaCleanupJobData> | null = null;

const processMediaCleanup = async (job: Job<MediaCleanupJobData>): Promise<void> => {
    const { publicId } = job.data;
    logger.debug('Processing media cleanup job', { jobId: job.id, publicId });
    await cloudinaryService.deleteImage(publicId);
    logger.info(`Successfully deleted media from Cloudinary: ${publicId}`);
};

export const startMediaCleanupWorker = (): void => {
    if (!config.features.useBackgroundJobs) {
        logger.info('Background jobs disabled, skipping media cleanup worker');
        return;
    }

    if (!ioRedis) {
        logger.warn('No Redis configured, media cleanup worker will not run');
        return;
    }

    worker = new Worker<MediaCleanupJobData>(
        QUEUE_NAMES.MEDIA_CLEANUP,
        processMediaCleanup,
        {
            connection: ioRedis as any,
            concurrency: 5,
        }
    );

    worker.on('failed', (job, err) => {
        logger.error(`Media cleanup job ${job?.id} failed with error`, { error: err });
    });

    logger.info('Media cleanup worker started');
};

export const stopMediaCleanupWorker = async (): Promise<void> => {
    if (worker) {
        await worker.close();
        logger.info('Media cleanup worker stopped');
    }
};
