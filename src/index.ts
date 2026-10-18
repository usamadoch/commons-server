import express, { Application, Request, Response } from 'express';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import cors from 'cors';

import cookieParser from 'cookie-parser';
import mongoose from 'mongoose';
import swaggerUi from 'swagger-ui-express';



// Middleware
import { apiLimiter } from './middleware/rateLimiter.js';
import { visitorIdMiddleware } from './middleware/visitorId.js';

// Config
import config from './config/index.js';
import logger, { correlationIdMiddleware, requestLogger } from './config/logger.js';
import { closeRedisConnections, ioRedis } from './config/redis.js';
import swaggerSpec from './config/swagger.js';


// Import routes
import authRoutes from './routes/auth.js';
import pageRoutes from './routes/page.js';

import membershipRoutes from './routes/member.js';
import postRoutes from './routes/post.js';
import conversationRoutes from './routes/conversation.js';
import errorHandler from './middleware/errorHandler.js';
import { connectDB } from './config/database.js';
import mediaRoutes from './routes/media.js';
import userRoutes from './routes/user.js';
import notificationRoutes from './routes/notification.js';
import analyticsRoutes from './routes/analytics.js';
import seedRoutes from './routes/seedRoutes.js';
import payoutRoutes from './routes/payout.js';
import adminRoutes from './routes/admin.js';
import membershipPlanRoutes from './routes/tier.js';
import webhookRoutes from './routes/webhook.js';
import liveRoutes from './routes/live.js';

// Import socket handlers
import { initializeSockets } from './sockets/index.js';
import { closeQueues, initializeQueues } from 'jobs/queues.js';
import { startNotificationWorker, stopNotificationWorker } from 'jobs/workers/notificationWorker.js';
import { startReconciliationCron } from './jobs/reconciliation.js';
import { startMediaCleanupWorker, stopMediaCleanupWorker } from './jobs/workers/mediaCleanupWorker.js';
import { startMediaCleanupCron } from './jobs/mediaCleanupCron.js';
import { startEmailWorker, stopEmailWorker } from './jobs/workers/emailWorker.js';




const app: Application = express();
const httpServer = createServer(app);



// Socket.io setup
const io = new SocketIOServer(httpServer, {
    cors: {
        origin: config.clientUrl.split(',').map(url => url.trim()),
        credentials: true,
    },
    pingTimeout: 60000,
    pingInterval: 25000,
});

// Make io accessible to routes
app.set('io', io);



app.set('trust proxy', 1);



app.use(correlationIdMiddleware);
app.use(requestLogger);

// CORS configuration
app.use(cors({
    origin: (origin, callback) => {
        const allowedOrigins = config.clientUrl.split(',').map(url => url.trim());
        const isStaging = config.env === 'staging' || process.env.APP_ENV === 'staging';
        // In staging, also permit dynamic Vercel Preview deployments (*.vercel.app)
        const isVercelPreview = isStaging && Boolean(origin && /^https:\/\/[a-zA-Z0-9_.-]+\.vercel\.app$/.test(origin));

        if (!origin || allowedOrigins.indexOf(origin) !== -1 || isVercelPreview) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'x-csrf-token']
}));

// JSON body parsing — skip routes that need raw body for HMAC signature verification
app.use((req, res, next) => {
    if (req.path === '/media/mux/webhook' || req.path === '/webhooks/safepay') {
        return next();
    }
    express.json({ limit: '10mb' })(req, res, next);
});
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser(config.cookie.secret));
app.use(visitorIdMiddleware);

// Apply CSRF protection to all routes except webhooks and public view tracking
import { doubleCsrfProtection } from './middleware/csrf.js';
app.use((req, res, next) => {
    if (
        req.path === '/media/mux/webhook' || 
        req.path === '/webhooks/safepay' ||
        /^\/posts\/[a-fA-F0-9]{24}\/view$/.test(req.path)
    ) {
        return next();
    }
    doubleCsrfProtection(req, res, next);
});

// Static files (uploads)
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));




// Swagger documentation
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
    customCss: '.swagger-ui .topbar { display: none }',
    customSiteTitle: 'Patreon MVP API Docs',
}));

// Health check (no rate limiting)
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

// Home route to verify server is running
// Home route to verify server is running and show config
app.get('/home', (_req: Request, res: Response) => {
    const mongoStatus = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';

    res.json({
        message: 'Server is online!',
        env: config.env,
        clientUrl: config.clientUrl,
        database: {
            status: mongoStatus
        },
        cors: {
            allowedOrigin: config.clientUrl
        }
    });
});

// Readiness check (checks DB and Redis)
app.get('/ready', async (_req: Request, res: Response) => {
    const mongoReady = mongoose.connection.readyState === 1;
    const redisReady = config.redis.ioRedisUrl && ioRedis ? ioRedis.status === 'ready' : true;

    const ready = mongoReady && redisReady;

    res.status(ready ? 200 : 503).json({
        success: ready,
        data: {
            status: ready ? 'ready' : 'not ready',
            services: {
                mongodb: mongoReady ? 'connected' : 'disconnected',
                redis: redisReady ? 'connected' : 'disconnected',
            },
        },
    });
});

// Apply rate limiting to API routes
app.use(apiLimiter);


// ... 

// API Routes
app.use('/auth', authRoutes);
app.use('/pages', pageRoutes);

app.use('/media', mediaRoutes); // New media pipeline
app.use('/members', membershipRoutes);
app.use('/posts', postRoutes);
app.use('/conversations', conversationRoutes);
app.use('/users', userRoutes);
app.use('/notifications', notificationRoutes);
app.use('/analytics', analyticsRoutes);
app.use('/seed', seedRoutes);
app.use('/payouts', payoutRoutes);
app.use('/admin', adminRoutes);
app.use('/tiers', membershipPlanRoutes);
app.use('/webhooks', webhookRoutes);
app.use('/live', liveRoutes);



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

// Error handler
app.use(errorHandler);



// Initialize socket handlers
initializeSockets(io);





// Graceful shutdown
const gracefulShutdown = async (signal: string): Promise<void> => {
    logger.info(`${signal} received, starting graceful shutdown...`);

    // Stop accepting new connections
    httpServer.close(() => {
        logger.info('HTTP server closed');
    });

    // Close Socket.io connections
    io.close(() => {
        logger.info('Socket.io connections closed');
    });

    try {
        await stopNotificationWorker();
        await stopEmailWorker();
        await stopMediaCleanupWorker();

        // Close job queues
        await closeQueues();

        // Close Redis connections
        await closeRedisConnections();

        // Close MongoDB connection
        await mongoose.connection.close();
        logger.info('MongoDB connection closed');

        logger.info('Graceful shutdown complete');
        process.exit(0);
    } catch (error) {
        logger.error('Error during graceful shutdown', { error });
        process.exit(1);
    }
};

// Register shutdown handlers
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception', { error: error.message, stack: error.stack });
    gracefulShutdown('UNCAUGHT_EXCEPTION');
});

process.on('unhandledRejection', (reason: unknown) => {
    logger.error('Unhandled rejection', { reason });
});

// Start server
const startServer = async (): Promise<void> => {
    try {
        // Connect to MongoDB
        await connectDB();
        logger.info('MongoDB connected');

        // Connect Redis for IORedis (if configured)
        if (config.redis.ioRedisUrl && ioRedis) {
            try {
                await ioRedis.connect();
                logger.info('Redis connected');

                // Setup Socket.io Redis adapter for horizontal scaling
                const pubClient = ioRedis.duplicate();
                const subClient = ioRedis.duplicate();
                // io.adapter(createAdapter(pubClient, subClient));
                logger.info('Socket.io Redis adapter configured');
            } catch (redisError) {
                logger.warn('Redis connection failed, running without Redis', { error: redisError });
            }
        }

        // Initialize BullMQ queues
        initializeQueues();

        // Start CRON jobs
        startReconciliationCron();
        startMediaCleanupCron();

        startNotificationWorker(io);
        startEmailWorker();
        startMediaCleanupWorker();

        // Start HTTP server
        httpServer.listen(config.port, () => {
            logger.info(`Server running on port ${config.port} in ${config.env} mode`);
            logger.info(`API Docs: http://localhost:${config.port}/api-docs`);
            logger.info(`Client URL: ${config.clientUrl}`);
        });
    } catch (error) {
        logger.error('Failed to start server', { error });
        process.exit(1);
    }
};

startServer();

export { app, io };

