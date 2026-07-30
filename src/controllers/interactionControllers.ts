import { Response, NextFunction } from 'express';
import { AuthenticatedRequest, MaybeAuthenticatedRequest } from '../types/index.js';
import { postInteractionService } from '../services/postInteractionService.js';
import { commentService } from '../services/commentService.js';
import { createError } from '../middleware/errorHandler.js';

export const toggleLikePost = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
        const result = await postInteractionService.toggleLikePost(req.user._id, req.params.id as string, req.user.displayName, req.app.get('io'));
        
        res.json({
            success: true,
            data: result,
        });
    } catch (error) {
        next(error);
    }
};

export const toggleLikeComment = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
        const result = await commentService.toggleLikeComment(req.user._id, req.params.id as string, req.user.displayName, req.app.get('io'));
        
        res.json({
            success: true,
            data: result,
        });
    } catch (error) {
        next(error);
    }
};

export const getPostComments = async (req: MaybeAuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
        const { page = 1, limit = 20 } = req.query;
        const result = await commentService.getPostComments(req.params.id as string, Number(page), Number(limit), req.user?._id);
        
        res.json({
            success: true,
            data: { comments: result.comments },
            meta: result.meta
        });
    } catch (error) {
        next(error);
    }
};

export const addPostComment = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
        const comment = await commentService.addPostComment(
            req.user._id,
            req.user.displayName,
            req.params.id as string,
            req.body.content,
            req.body.parentId,
            req.app.get('io')
        );
        
        res.status(201).json({
            success: true,
            data: { comment },
        });
    } catch (error) {
        next(error);
    }
};

export const votePoll = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
        const { optionIndexes } = req.body;
        if (!Array.isArray(optionIndexes)) {
            throw createError.invalidInput('optionIndexes must be an array');
        }
        
        const result = await postInteractionService.votePoll(req.user._id, req.params.id as string, optionIndexes);
        
        res.json({
            success: true,
            data: result,
        });
    } catch (error) {
        next(error);
    }
};
