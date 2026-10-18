import { Request, Response, NextFunction } from 'express';
import { AuthenticatedRequest, ONBOARDING_STEPS } from '../types/index.js';
import * as authService from '../services/authService.js';
import config from '../config/index.js';
import { generateToken } from '../middleware/csrf.js';

// Cookie options
// Cookie options
const isCrossSite = config.env === 'production' || config.env === 'staging' || process.env.APP_ENV === 'staging';
const cookieOptions = {
    httpOnly: true,
    secure: isCrossSite,
    sameSite: isCrossSite ? ('none' as const) : ('lax' as const),
    path: '/',
};

// CSRF Token controller
export const getCsrfToken = (
    req: Request,
    res: Response,
    next: NextFunction
): void => {
    try {
        const csrfToken = generateToken(req, res);
        res.json({
            success: true,
            data: { csrfToken },
        });
    } catch (error) {
        next(error);
    }
};

// Signup controller
export const signup = async (
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        const result = await authService.signup(req.body);

        // Set cookies
        res.cookie('accessToken', result.tokens.accessToken, {
            ...cookieOptions,
            maxAge: 15 * 60 * 1000, // 15 minutes
        });

        res.cookie('refreshToken', result.tokens.refreshToken, {
            ...cookieOptions,
            maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
        });

        res.status(201).json({
            success: true,
            data: {
                user: result.user,
            },
        });
    } catch (error) {
        next(error);
    }
};

// Check email controller
export const checkEmail = async (
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        const { email } = req.body;

        if (!email) {
            res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'Email is required',
                },
            });
            return;
        }

        const exists = await authService.checkEmail(email);
        res.json({
            success: true,
            data: { exists },
        });
    } catch (error) {
        next(error);
    }
};

// Login controller
export const login = async (
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        const result = await authService.login(req.body);

        // Set cookies
        res.cookie('accessToken', result.tokens.accessToken, {
            ...cookieOptions,
            maxAge: 15 * 60 * 1000,
        });

        res.cookie('refreshToken', result.tokens.refreshToken, {
            ...cookieOptions,
            maxAge: 7 * 24 * 60 * 60 * 1000,
        });

        res.json({
            success: true,
            data: {
                user: result.user,
            },
        });
    } catch (error) {
        next(error);
    }
};

// Google Login controller
export const googleLogin = async (
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        const { code, role } = req.body;

        if (!code) {
            res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'Authorization code is required',
                },
            });
            return;
        }

        const result = await authService.googleLogin(code, role);

        // Set cookies
        res.cookie('accessToken', result.tokens.accessToken, {
            ...cookieOptions,
            maxAge: 15 * 60 * 1000,
        });

        res.cookie('refreshToken', result.tokens.refreshToken, {
            ...cookieOptions,
            maxAge: 7 * 24 * 60 * 60 * 1000,
        });

        res.json({
            success: true,
            data: {
                user: result.user,
                isNewUser: result.isNewUser,
            },
        });
    } catch (error) {
        next(error);
    }
};

// Refresh token controller
export const refresh = async (
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        const refreshToken = req.cookies.refreshToken;

        if (!refreshToken) {
            res.status(401).json({
                success: false,
                error: {
                    code: 'UNAUTHORIZED',
                    message: 'No refresh token provided',
                },
            });
            return;
        }

        const tokens = await authService.refreshAccessToken(refreshToken);

        // Set new cookies
        res.cookie('accessToken', tokens.accessToken, {
            ...cookieOptions,
            maxAge: 15 * 60 * 1000,
        });

        res.cookie('refreshToken', tokens.refreshToken, {
            ...cookieOptions,
            maxAge: 7 * 24 * 60 * 60 * 1000,
        });

        res.json({
            success: true,
            data: { message: 'Tokens refreshed successfully' },
        });
    } catch (error) {
        next(error);
    }
};

// Logout controller
export const logout = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        const refreshToken = req.cookies.refreshToken;
        // user is guaranteed by AuthenticatedRequest
        const userId = req.user._id.toString();

        await authService.logout(userId, refreshToken);

        // Clear cookies
        res.clearCookie('accessToken', cookieOptions);
        res.clearCookie('refreshToken', cookieOptions);

        res.json({
            success: true,
            data: { message: 'Logged out successfully' },
        });
    } catch (error) {
        next(error);
    }
};

// Get current user controller
export const me = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        const userId = req.user._id.toString();
        const user = await authService.getCurrentUser(userId);

        if (!user) {
            res.status(404).json({
                success: false,
                error: {
                    code: 'NOT_FOUND',
                    message: 'User not found',
                },
            });
            return;
        }

        res.json({
            success: true,
            data: { user },
        });
    } catch (error) {
        next(error);
    }
};

// Get full user profile controller (for settings page)
export const fullProfile = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        const userId = req.user._id.toString();
        const user = await authService.getFullUser(userId);

        if (!user) {
            res.status(404).json({
                success: false,
                error: {
                    code: 'NOT_FOUND',
                    message: 'User not found',
                },
            });
            return;
        }

        res.json({
            success: true,
            data: { user },
        });
    } catch (error) {
        next(error);
    }
};

// Change password controller
export const changePassword = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        const userId = req.user._id.toString();
        await authService.changePassword(userId, req.body);

        res.json({
            success: true,
            data: { message: 'Password updated successfully' },
        });
    } catch (error) {
        next(error);
    }
};

// Update onboarding step controller
export const updateOnboardingStep = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        const userId = req.user._id.toString();
        const { step } = req.body;

        if (typeof step !== 'number' || step < ONBOARDING_STEPS.ACCOUNT_CREATED || step > ONBOARDING_STEPS.COMPLETE) {
            res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: `Step must be a number between ${ONBOARDING_STEPS.ACCOUNT_CREATED} and ${ONBOARDING_STEPS.COMPLETE}`,
                },
            });
            return;
        }

        const user = await authService.updateOnboardingStep(userId, step);

        res.json({
            success: true,
            data: { user },
        });
    } catch (error) {
        next(error);
    }
};

// Fetch Youtube Channels controller
export const fetchYoutubeChannels = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        const userId = req.user._id.toString();
        const { code } = req.body;

        if (!code) {
            res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'Authorization code is required',
                },
            });
            return;
        }

        const data = await authService.fetchYoutubeChannels(userId, code);

        res.json({
            success: true,
            data,
        });
    } catch (error) {
        next(error);
    }
};

// Connect Youtube controller
export const connectYoutube = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        const userId = req.user._id.toString();
        const { channelId, secureToken } = req.body;

        if (!channelId || !secureToken) {
            res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'channelId and secureToken are required',
                },
            });
            return;
        }

        await authService.connectYoutube(userId, channelId, secureToken);

        res.json({
            success: true,
            data: { message: 'YouTube channel connected successfully' },
        });
    } catch (error) {
        next(error);
    }
};

// Disconnect Youtube controller
export const disconnectYoutube = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        const userId = req.user._id.toString();

        await authService.disconnectYoutube(userId);

        res.json({
            success: true,
            data: { message: 'YouTube channel disconnected successfully' },
        });
    } catch (error) {
        next(error);
    }
};
