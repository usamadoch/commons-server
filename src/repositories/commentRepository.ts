import Comment from '../models/Comment.js';
import { Types } from 'mongoose';

export const commentRepository = {
    find: (query: Record<string, unknown>, populate?: { path: string, select?: string }, sort?: Record<string, -1 | 1>, skip?: number, limit?: number) => {
        let q = Comment.find(query);
        if (populate) q = q.populate(populate.path, populate.select);
        if (sort) q = q.sort(sort);
        if (skip !== undefined) q = q.skip(skip);
        if (limit !== undefined) q = q.limit(limit);
        return q;
    },

    findById: (id: string | Types.ObjectId, select?: string) => {
        let q: any = Comment.findById(id);
        if (select) q = q.select(select);
        return q;
    },

    findByIdAndUpdateNew: (id: string | Types.ObjectId, update: Record<string, unknown>) => {
        return Comment.findByIdAndUpdate(id, update, { new: true });
    },

    countDocuments: (query: Record<string, unknown>) => {
        return Comment.countDocuments(query);
    },

    create: (data: Record<string, unknown>) => {
        return Comment.create(data);
    },

    updateOne: (query: Record<string, unknown>, update: Record<string, unknown>) => {
        return Comment.updateOne(query, update);
    },

    deleteMany: (query: Record<string, unknown>) => {
        return Comment.deleteMany(query);
    }
};
