
import { randomBytes } from 'crypto';
import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../types/index.js';
import { cloudinaryService } from '../services/media/cloudinaryService.js';
import { muxService } from '../services/media/muxService.js';
import Post from '../models/Post.js';
import MediaAsset from '../models/MediaAsset.js';
import { addMediaCleanupJob, getMediaCleanupQueue } from '../jobs/queues.js';

// Helper to sanitize path components
const sanitize = (str: string) => str.replace(/[^a-z0-9_-]/gi, '_').toLowerCase();

export const getCloudinarySignature = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
        const type = req.query.type as string; // 'avatar', 'banner', 'post_img', 'thumbnail'
        const refId = req.query.refId as string | undefined; // postId
        const userId = req.user._id.toString();
        const username = sanitize(req.user.username);
        const env = process.env.NODE_ENV === 'production' ? 'prod' : 'dev';

        // 1. Role-based Access Control
        if (req.user.role === 'member') {
            if (type !== 'avatar') {
                res.status(403).json({
                    success: false,
                    error: { code: 'FORBIDDEN', message: 'Members can only upload avatars' }
                });
                return;
            }
        }

        // 2. Ownership Validation (for Posts)
        if (refId && (type === 'post_img' || type === 'thumbnail')) {
            // Check if post exists
            const post = await Post.findById(refId);
            if (post) {
                // Post exists, verify ownership
                if (post.creatorId.toString() !== userId) {
                    res.status(403).json({
                        success: false,
                        error: { code: 'FORBIDDEN', message: 'You do not own this post' }
                    });
                    return;
                }
            } else {
                // Post does not exist (New Draft)
                // We allow uploading to a non-existent ID because the client generates the ID
                // and the folder structure forces it under THIS user's directory.
                // So they can't upload to someone else's folder.
                // We just trust it's a new draft.
            }
        }

        // 3. Construct Public ID
        // Structure: env/u_{userId}/{username}/{context}/{filename}
        const uniqueSuffix = `${Date.now()}_${randomBytes(4).toString('hex')}`;
        let folderPath = `${env}/u_${userId}/${username}`;
        let filename = `${type}_${uniqueSuffix}`;

        if (type === 'avatar') {
            folderPath += `/profile`;
        } else if (type === 'banner') {
            folderPath += `/banner`;
        } else if ((type === 'post_img' || type === 'thumbnail') && refId) {
            folderPath += `/p_${refId}`;
        } else {
            // Fallback for other types or missing refId
            folderPath += `/misc`;
        }

        const public_id = `${folderPath}/${filename}`;

        // 4. Generate Signature including public_id
        // When signing public_id, we don't strictly need to pass 'folder' param to Cloudinary upload,
        // but 'public_id' param is required.
        // We pass 'public_id' to generateSignature to include it in the signature.
        const signatureData = cloudinaryService.generateSignature(undefined, public_id);

        res.json({
            success: true,
            data: {
                ...signatureData,
                public_id // Return explicitly so client can send it
            }
        });
    } catch (error) {
        next(error);
    }
};

export const registerPendingUpload = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
        const { cloudinaryPublicId, url } = req.body;
        
        if (!cloudinaryPublicId || !url) {
            res.status(400).json({ success: false, error: { message: 'Missing cloudinaryPublicId or url' }});
            return;
        }

        await MediaAsset.findOneAndUpdate(
            { cloudinaryPublicId },
            {
                cloudinaryPublicId,
                url,
                uploadedBy: req.user._id,
                status: 'pending'
            },
            { upsert: true, new: true }
        );

        res.json({ success: true });
    } catch (error) {
        next(error);
    }
};

export const getMuxUploadUrl = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
        // 1. Role-based Access Control
        if (req.user.role === 'member') {
            res.status(403).json({
                success: false,
                error: { code: 'FORBIDDEN', message: 'Members cannot upload videos' }
            });
            return;
        }

        const refId = req.query.refId as string | undefined;
        const userId = req.user._id.toString();
        const env = process.env.NODE_ENV === 'production' ? 'prod' : 'dev';

        // 2. Metadata for Mux Passthrough
        // Format: user_id:{userId}|env:{env}|ref_id:{refId}
        const passthrough = `user_id:${userId}|env:${env}${refId ? `|ref_id:${refId}` : ''}`;

        const uploadData = await muxService.createDirectUpload(passthrough);

        res.json({
            success: true,
            data: {
                url: uploadData.url,
                uploadId: uploadData.uploadId
            }
        });
    } catch (error) {
        next(error);
    }
};

export const deleteMedia = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
        const { type } = req.params;
        const id = req.params.id as string;

        if (!id) {
            res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'ID is required' } });
            return;
        }

        if (type !== 'image' && type !== 'video') {
            res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid media type' } });
            return;
        }

        if (type === 'image') {
            await MediaAsset.deleteOne({ cloudinaryPublicId: id });
        }

        const queue = getMediaCleanupQueue();
        if (queue) {
            await addMediaCleanupJob({ 
                type: type as 'image' | 'video', 
                publicId: type === 'image' ? id : undefined,
                muxAssetId: type === 'video' ? id : undefined 
            });
            res.json({
                success: true,
                message: 'Media queued for deletion'
            });
            return;
        }

        // Fallback to synchronous deletion if queue is disabled
        if (type === 'image') {
            await cloudinaryService.deleteImage(id);
        } else if (type === 'video') {
            await muxService.deleteAsset(id);
        }

        res.json({
            success: true,
            message: 'Media deleted successfully'
        });
    } catch (error) {
        next(error);
    }
};

// Webhook handler (must use raw body in router, but assuming here we typically get parsed body in clean architecture unless configured otherwise)
// IMPORTANT: Mux webhooks need the RAW body for signature verification.
// The router should use `express.raw({ type: 'application/json' })` for this specific route.
export const handleMuxWebhook = async (req: any, res: Response, next: NextFunction): Promise<void> => {
    console.log('========== MUX WEBHOOK CALLED ==========');
    // console.log('[Mux Webhook] Body type:', typeof req.body);
    // console.log('[Mux Webhook] Body is Buffer:', Buffer.isBuffer(req.body));
    // console.log('[Mux Webhook] Headers:', JSON.stringify(req.headers, null, 2));

    try {
        // console.log('[Mux Webhook] Received webhook request');
        const signature = req.headers['mux-signature'];
        // console.log('[Mux Webhook] Signature:', signature);

        // Verify signature - verifyWebhook throws if invalid
        // Note: req.body MUST be the raw buffer here
        muxService.verifyWebhook(req.body, signature);
        // console.log('[Mux Webhook] Signature verified');

        // Parse body now that it's verified
        const event = JSON.parse(req.body.toString());
        const { type, data } = event;
        // console.log('[Mux Webhook] Event type:', type);
        // console.log('[Mux Webhook] Event data:', JSON.stringify(data, null, 2));

        // Idempotency check could go here (store event.id in Redis) within a "processing" set

        if (type === 'video.upload.asset_created') {
            // data.id is the uploadId
            // data.asset_id is the new assetId
            // We need to link these. 
            // Since we stored uploadId in the Post, we can now find the Post and add the assetId.

            const uploadId = data.id;
            const assetId = data.asset_id;

            if (uploadId && assetId) {
                await Post.updateMany(
                    { "mediaAttachments.muxUploadId": uploadId },
                    {
                        $set: {
                            "mediaAttachments.$.muxAssetId": assetId,
                            "mediaAttachments.$.status": 'preparing'
                        }
                    }
                );
            }
        }
        else if (type === 'video.asset.ready') {
            const assetId = data.id;
            const playbackId = data.playback_ids?.[0]?.id;
            const duration = data.duration;
            const uploadId = data.upload_id;


            console.log('[Mux Webhook] asset ready:', data);


            // Get dimensions from video track
            let dimensions = undefined;
            if (data.tracks && Array.isArray(data.tracks)) {
                const videoTrack = data.tracks.find((t: any) => t.type === 'video');
                if (videoTrack) {
                    // Mux webhooks often use max_width/max_height for track details
                    const width = videoTrack.width || videoTrack.max_width;
                    const height = videoTrack.height || videoTrack.max_height;

                    if (width && height) {
                        dimensions = { width, height };
                    }
                }
            }

            if (assetId && playbackId) {
                // Construct query
                const matchConditions: any[] = [{ muxAssetId: assetId }];
                // Important: Also match by uploadId to handle race conditions where assetId isn't saved yet
                if (uploadId) {
                    matchConditions.push({ muxUploadId: uploadId });
                }

                await Post.updateMany(
                    {
                        mediaAttachments: {
                            $elemMatch: {
                                $or: matchConditions
                            }
                        }
                    },
                    {
                        $set: {
                            "mediaAttachments.$.status": 'ready',
                            "mediaAttachments.$.muxPlaybackId": playbackId,
                            "mediaAttachments.$.muxAssetId": assetId,
                            "mediaAttachments.$.duration": duration,
                            "mediaAttachments.$.url": `https://stream.mux.com/${playbackId}.m3u8`,
                            "mediaAttachments.$.thumbnailUrl": `https://image.mux.com/${playbackId}/thumbnail.png`,
                            ...(dimensions && { "mediaAttachments.$.dimensions": dimensions })
                        }
                    }
                );
            }
        }
        else if (type === 'video.asset.errored') {
            const assetId = data.id;
            console.log(`[Mux Webhook] Asset errored: ${assetId}`);
            if (assetId) {
                await Post.updateMany(
                    { "mediaAttachments.muxAssetId": assetId },
                    {
                        $set: {
                            "mediaAttachments.$.status": 'errored'
                        }
                    }
                );
            }
        }

        res.json({ received: true });

    } catch (error) {
        console.error("Webhook Error:", error);
        // Return 200 even on error to stop Mux from retrying endlessly for logic errors? 
        // Or 400 for signature errors.
        // Usually safe to return 200 validation success unless we want retries.
        res.status(400).send("Webhook verification failed or error processing");
    }
};
