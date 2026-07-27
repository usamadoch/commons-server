import { v2 as cloudinary } from 'cloudinary';
import config from '../../config/index.js';

cloudinary.config({
    cloud_name: config.cloudinary.cloudName,
    api_key: config.cloudinary.apiKey,
    api_secret: config.cloudinary.apiSecret,
});

export const cloudinaryService = {
    /**
     * Generates a signature for client-side uploads.
     * @returns {Object} { signature, timestamp, apiKey, cloudName }
     */
    generateSignature: (folder?: string, public_id?: string) => {
        const timestamp = Math.round((new Date()).getTime() / 1000);

        const params: Record<string, any> = {
            timestamp,
        };

        if (public_id) {
            params.public_id = public_id;
            // When public_id is provided content-aware, folder is implied by the public_id path structure
            // and should NOT be included as a separate parameter for signature.
        } else if (folder) {
            params.folder = folder;
        }

        const signature = cloudinary.utils.api_sign_request(params, config.cloudinary.apiSecret);

        return {
            timestamp,
            signature,
            apiKey: config.cloudinary.apiKey,
            cloudName: config.cloudinary.cloudName,
            folder: public_id ? undefined : folder, // Don't return folder if public_id handles it
            public_id
        };
    },

    /**
     * Deletes an image from Cloudinary.
     * @param publicId - The public ID of the image to delete
     */
    deleteImage: async (publicId: string) => {
        if (!publicId) return;
        await cloudinary.uploader.destroy(publicId);
    }
};
