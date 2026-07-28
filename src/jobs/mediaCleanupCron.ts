import cron from 'node-cron';
import MediaAsset from '../models/MediaAsset.js';
import { addMediaCleanupJob } from './queues.js';
import { logger } from '../config/logger.js';

export const startMediaCleanupCron = (): void => {
    // Run daily at 3:00 AM
    cron.schedule('0 3 * * *', async () => {
        logger.info('[MediaCleanup] Running orphan image cleanup...');
        
        try {
            const cutoffTime = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours ago

            // Find all pending uploads older than 24h
            const orphanedAssets = await MediaAsset.find({
                status: 'pending',
                createdAt: { $lt: cutoffTime }
            }).limit(100); // Process in batches

            if (orphanedAssets.length === 0) {
                logger.info('[MediaCleanup] No orphaned images found.');
                return;
            }

            for (const asset of orphanedAssets) {
                try {
                    // 1. Enqueue job to delete from Cloudinary
                    await addMediaCleanupJob({ type: 'image', publicId: asset.cloudinaryPublicId });
                    
                    // 2. Remove record from DB
                    await MediaAsset.deleteOne({ _id: asset._id });
                    
                    logger.info(`[MediaCleanup] Queued orphaned image for deletion: ${asset.cloudinaryPublicId}`);
                } catch (error) {
                    logger.error(`[MediaCleanup] Error queueing ${asset.cloudinaryPublicId}:`, error);
                }
            }
        } catch (err) {
            logger.error('[MediaCleanup] Critical error during cleanup run', err);
        }
    });

    logger.info('Media cleanup cron job scheduled');
};
