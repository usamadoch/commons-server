
import express, { Request, Response } from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import authRoutes from '../../src/routes/auth.js';
import pageRoutes from '../../src/routes/page.js';
import postRoutes from '../../src/routes/post.js';
import tierRoutes from '../../src/routes/tier.js';
import memberRoutes from '../../src/routes/member.js';
import userRoutes from '../../src/routes/user.js';
import notificationRoutes from '../../src/routes/notification.js';
import analyticsRoutes from '../../src/routes/analytics.js';
import errorHandler from '../../src/middleware/errorHandler.js';
import { correlationIdMiddleware } from '../../src/config/logger.js';

export const createTestApp = () => {
    const app = express();

    app.use(correlationIdMiddleware);
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    app.use(cookieParser('test-secret'));
    app.use(cors());

    // Mock rate limiter for tests to avoid issues
    app.use((_req, _res, next) => next());

    // Health check
    app.get('/health', (_req: Request, res: Response) => {
        res.json({
            success: true,
            data: {
                status: 'ok',
                timestamp: new Date().toISOString(),
                version: '1.0.0',
            },
        });
    });

    // Home route
    app.get('/home', (_req: Request, res: Response) => {
        res.json({
            message: 'Server is online!',
            env: 'test',
        });
    });

    // Routes
    app.use('/auth', authRoutes);
    app.use('/pages', pageRoutes);
    app.use('/posts', postRoutes);
    app.use('/tiers', tierRoutes);
    app.use('/members', memberRoutes);
    app.use('/users', userRoutes);
    app.use('/notifications', notificationRoutes);
    app.use('/analytics', analyticsRoutes);

    // 404 handler
    app.use((_req: Request, res: Response) => {
        res.status(404).json({
            success: false,
            error: {
                code: 'NOT_FOUND',
                message: 'The requested resource was not found',
            },
        });
    });

    // Error Handler
    app.use(errorHandler);

    return app;
};
