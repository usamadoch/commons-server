import PostViewDedup from '../models/PostViewDedup.js';
import { Types } from 'mongoose';

export const postViewDedupRepository = {
    findOneAndUpdate: (
        query: Record<string, unknown>,
        update: Record<string, unknown>,
        options?: Record<string, unknown>
    ) => {
        return PostViewDedup.findOneAndUpdate(query, update, options);
    },

    create: (data: {
        postId: Types.ObjectId | string;
        viewerKey: string;
        viewedAt: Date;
        expiresAt: Date;
    }) => {
        return PostViewDedup.create(data);
    },

    deleteMany: (query: Record<string, unknown>) => {
        return PostViewDedup.deleteMany(query);
    },

    findOne: (query: Record<string, unknown>) => {
        return PostViewDedup.findOne(query);
    },
};
