import { Worker, Job } from 'bullmq';
import config from '../../config/index.js';
import { logger } from '../../config/logger.js';
import { ioRedis } from '../../config/redis.js';
import { QUEUE_NAMES, QUEUE_PREFIX, MediaCleanupJobData } from '../queues.js';
import { cloudinaryService } from '../../services/media/cloudinaryService.js';
import { muxService } from '../../services/media/muxService.js';
let worker: Worker<MediaCleanupJobData> | null = null;

const processMediaCleanup = async (job: Job<MediaCleanupJobData>): Promise<void> => {
    const { type, publicId, muxAssetId } = job.data;
    logger.debug('Processing media cleanup job', { jobId: job.id, type, publicId, muxAssetId });

    if (type === 'image' && publicId) {
        await cloudinaryService.deleteImage(publicId);
        logger.info(`Successfully deleted image from Cloudinary: ${publicId}`);
    } else if (type === 'video' && muxAssetId) {
        await muxService.deleteAsset(muxAssetId);
        logger.info(`Successfully deleted video asset from Mux: ${muxAssetId}`);
    } else {
        logger.warn('Unknown media cleanup type or missing identifier', { type, publicId, muxAssetId });
    }
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
            prefix: QUEUE_PREFIX,
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
