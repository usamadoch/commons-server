import { Response, NextFunction } from 'express';
import { AuthenticatedRequest, MaybeAuthenticatedRequest } from '../types/index.js';
import { postCrudService } from '../services/postCrudService.js';

export const getPostById = async (req: MaybeAuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
        const sessionId = req.cookies?.sessionId || req.ip || 'anonymous';
        const result = await postCrudService.getPostById(req.params.id as string, req.user?._id?.toString() || null, sessionId);
        
        res.json({
            success: true,
            data: result,
        });
    } catch (error) {
        next(error);
    }
};

export const createPost = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
        const post = await postCrudService.createPost(req.user._id, req.body, req.app.get('io'));
        
        res.status(201).json({
            success: true,
            data: { post },
        });
    } catch (error) {
        next(error);
    }
};

export const updatePost = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
        const post = await postCrudService.updatePost(req.user._id, req.params.id as string, req.body, req.app.get('io'));
        
        res.json({
            success: true,
            data: { post },
        });
    } catch (error) {
        next(error);
    }
};

export const deletePost = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
        await postCrudService.deletePost(req.user._id, req.params.id as string);
        
        res.json({
            success: true,
            data: { message: 'Post deleted successfully' },
        });
    } catch (error) {
        next(error);
    }
};
