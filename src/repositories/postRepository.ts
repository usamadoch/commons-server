import Post from '../models/Post.js';
import { Types } from 'mongoose';

export const postRepository = {
    find: (query: Record<string, unknown>, select?: string, sort?: Record<string, -1 | 1>, skip?: number, limit?: number) => {
        let q: any = Post.find(query);
        if (select) q = q.select(select);
        if (sort) q = q.sort(sort);
        if (skip !== undefined) q = q.skip(skip);
        if (limit !== undefined) q = q.limit(limit);
        return q.lean();
    },
    
    findNotLean: (query: Record<string, unknown>, select?: string, sort?: Record<string, -1 | 1>, skip?: number, limit?: number) => {
        let q: any = Post.find(query);
        if (select) q = q.select(select);
        if (sort) q = q.sort(sort);
        if (skip !== undefined) q = q.skip(skip);
        if (limit !== undefined) q = q.limit(limit);
        return q;
    },

    findAndPopulate: (
        query: Record<string, unknown>, 
        populateField: string, 
        populateSelect: string, 
        sort?: Record<string, -1 | 1>, 
        limit?: number
    ) => {
        let q: any = Post.find(query);
        if (sort) q = q.sort(sort);
        if (limit !== undefined) q = q.limit(limit);
        return q.populate(populateField, populateSelect).lean();
    },

    findById: (id: string | Types.ObjectId, select?: string) => {
        let q: any = Post.findById(id);
        if (select) q = q.select(select);
        return q;
    },
    
    findByIdPopulated: (id: string | Types.ObjectId) => {
        return Post.findById(id)
            .populate('creatorId', 'displayName username avatarUrl')
            .populate('pageId', 'pageSlug displayName avatarUrl')
            .lean();
    },

    countDocuments: (query: Record<string, unknown>) => {
        return Post.countDocuments(query);
    },

    create: (data: Record<string, unknown>) => {
        return Post.create(data);
    },

    findOne: (query: Record<string, unknown>) => {
        return Post.findOne(query);
    },
    
    findOneAndDelete: (query: Record<string, unknown>) => {
        return Post.findOneAndDelete(query);
    },

    updateOne: (query: Record<string, unknown>, update: Record<string, unknown>) => {
        return Post.updateOne(query, update);
    },
    
    findByIdAndUpdateNew: (id: string | Types.ObjectId, update: Record<string, unknown>) => {
        return Post.findByIdAndUpdate(id, update, { new: true });
    },

    distinct: (field: string, query: Record<string, unknown>) => {
        return Post.find(query).distinct(field);
    },

    findLean: (query: Record<string, unknown>, select?: string, sort?: Record<string, -1 | 1>, limit?: number) => {
        let q: any = Post.find(query);
        if (select) q = q.select(select);
        if (sort) q = q.sort(sort);
        if (limit !== undefined) q = q.limit(limit);
        return q.lean();
    }
};
