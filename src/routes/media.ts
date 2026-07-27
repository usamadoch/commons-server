import { Router, RequestHandler } from 'express';
import express from 'express';
import { protect } from '../middleware/auth.js';
import {
    getCloudinarySignature,
    registerPendingUpload,
    getMuxUploadUrl,
    handleMuxWebhook,
    deleteMedia
} from '../controllers/mediaController.js';

const router = Router();

// Get Cloudinary Signature (Auth required)
router.get('/cloudinary/signature', protect, getCloudinarySignature as RequestHandler);

// Register Pending Cloudinary Upload (Auth required)
router.post('/cloudinary/register-upload', protect, registerPendingUpload as RequestHandler);

// Get Mux Upload URL (Auth required)
router.get('/mux/upload-url', protect, getMuxUploadUrl as RequestHandler);

// Delete Media (Auth required)
router.delete('/:type/:id', protect, deleteMedia as RequestHandler);

// Mux Webhook (Public, Raw body for verification)
// We need to use express.raw for this specific route to verify signatures
router.post(
    '/mux/webhook',
    express.raw({ type: 'application/json' }),
    handleMuxWebhook as RequestHandler
);

export default router;
