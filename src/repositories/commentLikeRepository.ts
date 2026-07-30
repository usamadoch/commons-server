import CommentLike from '../models/CommentLike.js';

export const commentLikeRepository = {
    find: (query: Record<string, unknown>, select?: string) => {
        let q: any = CommentLike.find(query);
        if (select) q = q.select(select);
        return q;
    },

    exists: (query: Record<string, unknown>) => {
        return CommentLike.exists(query);
    },

    findOneAndDelete: (query: Record<string, unknown>) => {
        return CommentLike.findOneAndDelete(query);
    },

    create: (data: Record<string, unknown>) => {
        return CommentLike.create(data);
    },

    deleteMany: (query: Record<string, unknown>) => {
        return CommentLike.deleteMany(query);
    }
};
