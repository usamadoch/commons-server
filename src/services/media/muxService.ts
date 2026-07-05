import Mux from '@mux/mux-node';
import config from '../../config/index.js';

// Initialize Mux SDK with webhookSecret for signature verification
const mux = new Mux({
    tokenId: config.mux.tokenId,
    tokenSecret: config.mux.tokenSecret,
    webhookSecret: config.mux.webhookSecret,
});

export const muxService = {
    /**
     * Creates a direct upload URL for the client.
     * @returns {Promise<Object>} { url, uploadId }
     */
    createDirectUpload: async (passthrough?: string) => {
        const upload = await mux.video.uploads.create({
            new_asset_settings: {
                playback_policy: ['public'],
                // Note: mp4_support removed - 'standard' is deprecated on basic tier
                ...(passthrough && { passthrough }),
            },
            cors_origin: config.clientUrl.split(',')[0].trim(), // Important for browser uploads
        });

        return {
            url: upload.url,
            uploadId: upload.id,
        };
    },

    /**
     * Gets asset details by Asset ID.
     * @param assetId 
     */
    getAsset: async (assetId: string) => {
        return await mux.video.assets.retrieve(assetId);
    },

    /**
     * Gets upload details by Upload ID.
     * @param uploadId 
     */
    getUpload: async (uploadId: string) => {
        return await mux.video.uploads.retrieve(uploadId);
    },

    /**
     * Deletes an asset from Mux.
     * @param assetId 
     */
    deleteAsset: async (assetId: string) => {
        if (!assetId) return;
        try {
            await mux.video.assets.delete(assetId);
        } catch (error) {
            console.error('Failed to delete Mux asset:', error);
        }
    },

    /**
     * Verify webhook signature using the raw body.
     * Uses Mux SDK instance method which validates timestamp and signature.
     */
    verifyWebhook: (body: string | Buffer, signature: string | string[]) => {
        // Convert Buffer to string if needed - SDK requires string body
        const bodyString = typeof body === 'string' ? body : body.toString('utf8');

        // Build headers object as expected by SDK
        const headers = {
            'mux-signature': Array.isArray(signature) ? signature[0] : signature
        };

        // Use instance method - webhookSecret was passed to constructor
        // This will throw if verification fails
        mux.webhooks.verifySignature(bodyString, headers);
    }
};
