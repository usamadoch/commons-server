import { Router, RequestHandler, Request, Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../types/index.js';


import * as authController from '../controllers/authController.js';
import { loginLimiter, signupLimiter } from '../middleware/rateLimiter.js';
import { signupSchema, loginSchema, checkEmailSchema, changePasswordSchema } from '../utils/validators.js';
import { validate } from '../middleware/validate.js';
import { protect } from '../middleware/auth.js';

const router = Router();

// Type-safe wrapper for authenticated handlers
// After protect middleware, req is guaranteed to be AuthenticatedRequest
const asAuthHandler = (handler: (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
) => Promise<void>): RequestHandler => handler as any;

/**
 * @swagger
 * /auth/csrf:
 *   get:
 *     summary: Get CSRF token
 *     tags: [Auth]
 *     responses:
 *       200:
 *         description: CSRF token successfully retrieved
 */
router.get('/csrf', authController.getCsrfToken);

/**
 * @swagger
 * /auth/signup:
 *   post:
 *     summary: Register a new user
 *     tags: [Auth]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password, displayName, username]
 *             properties:
 *               email: { type: string, format: email }
 *               password: { type: string, minLength: 8 }
 *               displayName: { type: string }
 *               username: { type: string }
 *               role: { type: string, enum: [member, creator] }
 *     responses:
 *       201:
 *         description: User created successfully
 *       400:
 *         description: Validation error
 *       409:
 *         description: Email or username already exists
 */
router.post('/signup', signupLimiter, validate(signupSchema), authController.signup);

/**
 * @swagger
 * /auth/check-email:
 *   post:
 *     summary: Check if email exists
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email: { type: string, format: email }
 *     responses:
 *       200:
 *         description: Check result
 */
router.post('/check-email', validate(checkEmailSchema), authController.checkEmail);

/**
 * @swagger
 * /auth/login:
 *   post:
 *     summary: Login with email and password
 *     tags: [Auth]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email: { type: string, format: email }
 *               password: { type: string }
 *     responses:
 *       200:
 *         description: Login successful
 *       401:
 *         description: Invalid credentials
 *       429:
 *         description: Too many login attempts
 */

router.post('/login', loginLimiter, validate(loginSchema), authController.login);

/**
 * @swagger
 * /auth/google:
 *   post:
 *     summary: Login with Google
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [code]
 *             properties:
 *               code: { type: string }
 *               role: { type: string, enum: [member, creator] }
 *     responses:
 *       200:
 *         description: Login successful
 *       400:
 *         description: Invalid code
 */
router.post('/google', authController.googleLogin);

/**
 * @swagger
 * /auth/youtube/channels:
 *   post:
 *     summary: Fetch YouTube channels
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [code]
 *             properties:
 *               code: { type: string }
 *     responses:
 *       200:
 *         description: Channels fetched successfully (returns signed token and channels)
 */
router.post('/youtube/channels', protect, asAuthHandler(authController.fetchYoutubeChannels));

/**
 * @swagger
 * /auth/youtube/connect:
 *   post:
 *     summary: Connect YouTube channel
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [channelId, secureToken]
 *             properties:
 *               channelId: { type: string }
 *               secureToken: { type: string }
 *     responses:
 *       200:
 *         description: YouTube connected successfully
 */
router.post('/youtube/connect', protect, asAuthHandler(authController.connectYoutube));

/**
 * @swagger
 * /auth/youtube/disconnect:
 *   post:
 *     summary: Disconnect YouTube channel
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: YouTube disconnected successfully
 */
router.post('/youtube/disconnect', protect, asAuthHandler(authController.disconnectYoutube));

/**
 * @swagger
 * /auth/refresh:
 *   post:
 *     summary: Refresh access token
 *     tags: [Auth]
 *     security: []
 *     responses:
 *       200:
 *         description: Tokens refreshed
 *       401:
 *         description: Invalid or expired refresh token
 */
router.post('/refresh', authController.refresh);

/**
 * @swagger
 * /auth/logout:
 *   post:
 *     summary: Logout current user
 *     tags: [Auth]
 *     responses:
 *       200:
 *         description: Logout successful
 *       401:
 *         description: Not authenticated
 */
router.post('/logout', protect, asAuthHandler(authController.logout));

/**
 * @swagger
 * /auth/me:
 *   get:
 *     summary: Get current user profile
 *     tags: [Auth]
 *     responses:
 *       200:
 *         description: User profile
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     user: { $ref: '#/components/schemas/User' }
 *       401:
 *         description: Not authenticated
 */
router.get('/me/full', protect, asAuthHandler(authController.fullProfile));
router.get('/me', protect, asAuthHandler(authController.me));
/**
 * @swagger
 * /auth/change-password:
 *   post:
 *     summary: Change password
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [currentPassword, newPassword]
 *             properties:
 *               currentPassword: { type: string }
 *               newPassword: { type: string, minLength: 8 }
 *     responses:
 *       200:
 *         description: Password updated successfully
 *       401:
 *         description: Not authenticated
 *       400:
 *         description: Invalid password or validation error
 */
router.post('/change-password', protect, validate(changePasswordSchema), asAuthHandler(authController.changePassword));

/**
 * @swagger
 * /auth/onboarding-step:
 *   patch:
 *     summary: Update onboarding step
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [step]
 *             properties:
 *               step: { type: number, minimum: 1, maximum: 4 }
 *     responses:
 *       200:
 *         description: Onboarding step updated
 *       401:
 *         description: Not authenticated
 *       400:
 *         description: Invalid step
 */
router.patch('/onboarding-step', protect, asAuthHandler(authController.updateOnboardingStep));

export default router;


















































