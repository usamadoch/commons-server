
import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import authRoutes from '../../src/routes/auth.js';
import errorHandler from '../../src/middleware/errorHandler.js';
import { apiLimiter } from '../../src/middleware/rateLimiter.js';

// Mock config if needed, or rely on .env.test
// For now, we assume .env is loaded or defaults work

export const createTestApp = () => {
    const app = express();

    // Middleware matches index.ts (simplified)
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    app.use(cookieParser('test-secret'));
    app.use(cors());

    // Mock rate limiter for tests to avoid issues
    app.use((req, res, next) => next());

    // Routes
    app.use('/auth', authRoutes);
    // Add other routes as needed for integration tests

    // Error Handler
    app.use(errorHandler);

    return app;
};
