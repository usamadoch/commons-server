import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import config from '../config/index.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface VisitorRequest extends Request {
    visitorId?: string;
}

/**
 * Middleware that ensures every incoming request has a valid, server-signed visitorId cookie.
 * If missing, invalid, or forged, a new UUIDv4 is generated and set as a signed HttpOnly cookie.
 */
export const visitorIdMiddleware = (req: Request, res: Response, next: NextFunction): void => {
    let vid = req.signedCookies?.visitorId;

    if (!vid || typeof vid !== 'string' || !UUID_REGEX.test(vid)) {
        vid = crypto.randomUUID();
        res.cookie('visitorId', vid, {
            httpOnly: true,
            secure: config.env === 'production',
            sameSite: 'lax',
            maxAge: 365 * 24 * 60 * 60 * 1000, // 1 year
            signed: true,
        });
    }

    (req as VisitorRequest).visitorId = vid;
    next();
};
