import { Response, NextFunction } from 'express';
import { AuthenticatedRequest, MaybeAuthenticatedRequest } from '../types/index.js';
import { postQueryService } from '../services/postQueryService.js';
import { feedService } from '../services/feedService.js';
import { createError } from '../middleware/errorHandler.js';

export const getMyPosts = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
        const { page = 1, limit = 10 } = req.query;
        const result = await postQueryService.getMyPosts(req.user._id, Number(page), Number(limit));
        
        res.json({
            success: true,
            data: { posts: result.posts },
            meta: result.meta
        });
    } catch (error) {
        next(error);
    }
};

export const getCreatorPosts = async (req: MaybeAuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
        const { pageSlug, limit = 100, type } = req.query;
        
        if (!pageSlug) {
            throw createError.invalidInput('pageSlug is required');
        }

        const posts = await postQueryService.getCreatorPosts(
            String(pageSlug),
            Number(limit),
            type ? String(type) : undefined,
            req.user?._id
        );

        res.json({
            success: true,
            data: { posts },
        });
    } catch (error) {
        next(error);
    }
};

export const getRecentVideos = async (req: MaybeAuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
        const { pageSlug, limit = 5 } = req.query;
        
        if (!pageSlug) {
            throw createError.invalidInput('pageSlug is required');
        }

        const posts = await postQueryService.getRecentVideos(String(pageSlug), Number(limit));
        
        res.json({
            success: true,
            data: { posts },
        });
    } catch (error) {
        next(error);
    }
};

export const getHomeFeed = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
        const { cursor, limit = 10 } = req.query;
        const result = await feedService.getHomeFeed(req.user._id, cursor ? String(cursor) : undefined, Number(limit));
        
        res.json({
            success: true,
            data: { posts: result.posts },
            meta: { hasNextPage: result.hasNextPage, nextCursor: result.nextCursor },
        });
    } catch (error) {
        next(error);
    }
};
