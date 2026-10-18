import winston from 'winston';
import { v4 as uuidv4 } from 'uuid';
import { Request, Response, NextFunction } from 'express';
import http from 'http';
import config from './index.js';
import type { IUser } from '../types/index.js';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** Status code classification — exhaustive, no default needed */
type StatusCategory = 'success' | 'redirect' | 'clientError' | 'serverError';

/** Structured request log data attached to every completed request */
interface RequestLogData {
    correlationId: string;
    method: string;
    path: string;          // full originalUrl (e.g. /api/posts?page=1)
    statusCode: number;
    duration: number;      // raw ms — formatted only at presentation time
    userId: string | null; // null when unauthenticated (domain-valid absence)
    username: string | null;
    ip: string;
    userAgent: string;
}

/** Structured error log data from the error handler middleware */
interface ErrorLogData {
    correlationId: string;
    method: string;
    path: string;
    error: string;
    stack: string | undefined;
    statusCode: number;
    code: string;
    isOperational: boolean;
}

/** Slow-request threshold in ms. Requests exceeding this are flagged. */
const SLOW_REQUEST_THRESHOLD_MS = 1000;

// ─────────────────────────────────────────────────────────────────────────────
// ANSI color helpers (only used in dev console format)
// ─────────────────────────────────────────────────────────────────────────────

const ANSI = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    dim: '\x1b[2m',

    // Foreground
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m',
    white: '\x1b[37m',
    gray: '\x1b[90m',

    // Background
    bgRed: '\x1b[41m',
    bgGreen: '\x1b[42m',
    bgYellow: '\x1b[43m',
    bgCyan: '\x1b[46m',
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function classifyStatus(code: number): StatusCategory {
    if (code >= 200 && code < 300) return 'success';
    if (code >= 300 && code < 400) return 'redirect';
    if (code >= 400 && code < 500) return 'clientError';
    return 'serverError';
}

function statusColor(category: StatusCategory): string {
    const map: Record<StatusCategory, string> = {
        success: ANSI.green,
        redirect: ANSI.cyan,
        clientError: ANSI.yellow,
        serverError: ANSI.red,
    };
    return map[category];
}

function statusIcon(category: StatusCategory): string {
    const map: Record<StatusCategory, string> = {
        success: '✅',
        redirect: '↩️',
        clientError: '⚠️',
        serverError: '❌',
    };
    return map[category];
}

function methodColor(method: string): string {
    const map: Record<string, string> = {
        GET: ANSI.green,
        POST: ANSI.cyan,
        PUT: ANSI.yellow,
        PATCH: ANSI.yellow,
        DELETE: ANSI.red,
    };
    return map[method] ?? ANSI.white;
}

/** Shortens a UUID to the first 8 characters for readability */
function shortId(id?: string | null): string {
    return id ? id.substring(0, 8) : '--------';
}

// ─────────────────────────────────────────────────────────────────────────────
// Production format (structured JSON for log aggregation)
// ─────────────────────────────────────────────────────────────────────────────

const productionFormat = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.json()
);

// ─────────────────────────────────────────────────────────────────────────────
// Dev format: box-drawn, colorized, multi-line request logs
// ─────────────────────────────────────────────────────────────────────────────

const devFormat = winston.format.combine(
    winston.format.timestamp({ format: 'HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.printf((info) => {
        const { level, message, timestamp } = info;

        // ── Request completion logs → compact 3-line box ──
        if (message === 'Request completed' && info.requestLog) {
            const log = info.requestLog as RequestLogData;
            return formatRequestBox(log, timestamp as string);
        }

        // ── Error handler logs → compact error block ──
        if (info.errorLog) {
            const err = info.errorLog as ErrorLogData;
            return formatErrorBlock(err, timestamp as string, level);
        }

        // ── All other logs: clean single-line format ──
        return `${ANSI.gray}${timestamp}${ANSI.reset} ${level} ${message}`;
    })
);

function formatRequestBox(log: RequestLogData, timestamp: string): string {
    const category = classifyStatus(log.statusCode);
    const color = statusColor(category);
    const icon = statusIcon(category);
    const isSlow = log.duration > SLOW_REQUEST_THRESHOLD_MS;
    const mColor = methodColor(log.method);

    // Duration
    const durationStr = isSlow
        ? `${ANSI.yellow}${ANSI.bold}${log.duration}ms 🐢${ANSI.reset}`
        : `${ANSI.green}${log.duration}ms${ANSI.reset}`;

    // Tag (right side badge)
    let tag = '';
    if (category === 'serverError') tag = `${ANSI.bgRed}${ANSI.white}${ANSI.bold} ERROR ${ANSI.reset} `;
    else if (category === 'clientError') tag = `${ANSI.bgYellow}${ANSI.white}${ANSI.bold} WARN ${ANSI.reset} `;
    else if (isSlow) tag = `${ANSI.bgYellow}${ANSI.white}${ANSI.bold} SLOW ${ANSI.reset} `;

    // User
    const userStr = log.userId
        ? `${shortId(log.userId)} (${log.username})`
        : 'anonymous';

    const statusPhrase = http.STATUS_CODES[log.statusCode] || 'Unknown';

    // Line 1: method + path + status + phrase + duration
    const line1 = `${ANSI.dim}┌${ANSI.reset} ${tag}${mColor}${ANSI.bold}${log.method}${ANSI.reset} ${ANSI.white}${log.path}${ANSI.reset} ${ANSI.dim}──${ANSI.reset} ${color}${ANSI.bold}${log.statusCode} ${statusPhrase}${ANSI.reset} ${icon} ${ANSI.dim}──${ANSI.reset} ${durationStr}`;
    // Line 2: user + ip + reqId + timestamp
    const line2 = `${ANSI.dim}│${ANSI.reset}  ${ANSI.dim}${timestamp}${ANSI.reset} · ${userStr} · ${ANSI.dim}${log.ip}${ANSI.reset} · ${ANSI.dim}${shortId(log.correlationId)}${ANSI.reset}`;
    // Line 3: separator
    const line3 = `${ANSI.dim}└${'─'.repeat(60)}${ANSI.reset}`;

    return `${line1}\n${line2}\n${line3}`;
}

function formatErrorBlock(err: ErrorLogData, timestamp: string, level: string): string {
    const isOperational = err.isOperational;
    const color = isOperational ? ANSI.yellow : ANSI.red;
    const badge = isOperational
        ? `${ANSI.bgYellow}${ANSI.white}${ANSI.bold} ${err.code} ${ANSI.reset}`
        : `${ANSI.bgRed}${ANSI.white}${ANSI.bold} ${err.code} ${ANSI.reset}`;
    const mColor = methodColor(err.method);

    // Line 1: badge + method + path + error message
    const line1 = `${badge} ${mColor}${ANSI.bold}${err.method}${ANSI.reset} ${ANSI.white}${err.path}${ANSI.reset} ${ANSI.dim}──${ANSI.reset} ${color}${err.error}${ANSI.reset}`;

    const statusPhrase = http.STATUS_CODES[err.statusCode] || 'Unknown';
    // Line 2: timestamp + status + phrase + reqId
    const line2 = `  ${ANSI.dim}${timestamp} · ${err.statusCode} ${statusPhrase} · ${shortId(err.correlationId)}${ANSI.reset}`;

    return `${line1}\n${line2}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Logger instance
// ─────────────────────────────────────────────────────────────────────────────

const isDev = config.env !== 'production';

export const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || (isDev ? 'debug' : 'info'),
    format: productionFormat,
    defaultMeta: { service: 'patreon-mvp' },
    transports: [
        new winston.transports.Console({
            format: isDev ? devFormat : productionFormat,
        }),
    ],
});

// File transports for production
if (!isDev) {
    logger.add(new winston.transports.File({
        filename: 'logs/error.log',
        level: 'error',
        maxsize: 5242880, // 5MB
        maxFiles: 5,
    }));
    logger.add(new winston.transports.File({
        filename: 'logs/combined.log',
        maxsize: 5242880,
        maxFiles: 5,
    }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Extend Express Request type
// ─────────────────────────────────────────────────────────────────────────────

declare global {
    namespace Express {
        interface Request {
            correlationId: string; // Always set by correlationIdMiddleware — not optional
            /**
             * Populated by auth middleware (protect / optionalAuth).
             * Optional because not all routes require authentication.
             */
            user?: IUser;
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Middleware: Correlation ID
// ─────────────────────────────────────────────────────────────────────────────

export const correlationIdMiddleware = (req: Request, res: Response, next: NextFunction): void => {
    const correlationId = (req.headers['x-correlation-id'] as string) || uuidv4();
    req.correlationId = correlationId;
    res.setHeader('x-correlation-id', correlationId);
    next();
};

// ─────────────────────────────────────────────────────────────────────────────
// Middleware: Request Logger
// ─────────────────────────────────────────────────────────────────────────────

export const requestLogger = (req: Request, res: Response, next: NextFunction): void => {
    const startTime = Date.now();

    res.on('finish', () => {
        const duration = Date.now() - startTime;

        const logData: RequestLogData = {
            correlationId: req.correlationId,
            method: req.method,
            path: req.originalUrl || req.path,
            statusCode: res.statusCode,
            duration,
            userId: req.user?._id?.toString() ?? null,
            username: req.user?.username ?? null,
            ip: req.ip || 'unknown',
            userAgent: req.headers['user-agent'] || 'unknown',
        };

        // Determine log level based on status code
        const category = classifyStatus(res.statusCode);

        if (category === 'serverError') {
            logger.error('Request completed', {
                requestLog: logData,
                // Production-friendly flat fields for JSON format
                ...logData,
                duration: `${duration}ms`,
            });
        } else if (category === 'clientError') {
            logger.warn('Request completed', {
                requestLog: logData,
                ...logData,
                duration: `${duration}ms`,
            });
        } else {
            logger.info('Request completed', {
                requestLog: logData,
                ...logData,
                duration: `${duration}ms`,
            });
        }
    });

    next();
};

// ─────────────────────────────────────────────────────────────────────────────
// Child logger factory
// ─────────────────────────────────────────────────────────────────────────────

/** Creates a child logger bound to a specific correlation ID for tracing */
export const createLogger = (correlationId: string) => {
    return logger.child({ correlationId });
};

export default logger;
