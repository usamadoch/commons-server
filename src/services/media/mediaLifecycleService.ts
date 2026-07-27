import { Types } from 'mongoose';
import { extractPublicIdFromUrl } from '../../utils/cloudinaryTransforms.js';
import { addMediaCleanupJob } from '../../jobs/queues.js';
import MediaAsset from '../../models/MediaAsset.js';

export const mediaLifecycleService = {
    /**
     * Handles the cleanup and state transition when a user replaces an image (avatar, banner, etc.)
     */
    async handleImageReplacement(
        oldUrl: string | null | undefined,
        newUrl: string | undefined,
        userId: string | Types.ObjectId,
        refType: 'User' | 'Page' | 'Post',
        refId: string | Types.ObjectId
    ) {
        if (!newUrl || oldUrl === newUrl) return;

        // Attach the new image
        const newPublicId = extractPublicIdFromUrl(newUrl);
        if (newPublicId) {
            await MediaAsset.findOneAndUpdate(
                { cloudinaryPublicId: newPublicId, uploadedBy: userId },
                { status: 'attached', refType, refId }
            );
        }

        // Cleanup the old image
        if (oldUrl) {
            const oldPublicId = extractPublicIdFromUrl(oldUrl);
            if (oldPublicId) {
                addMediaCleanupJob({ publicId: oldPublicId }).catch(err =>
                    console.error(`Failed to enqueue cleanup job for ${refType}`, err)
                );
            }
        }
    }
};
