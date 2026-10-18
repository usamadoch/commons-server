import CreatorPage from '../models/CreatorPage.js';
import { Types } from 'mongoose';

export const creatorPageRepository = {
    find: (query: Record<string, unknown>, select?: string, sort?: Record<string, -1 | 1>, limit?: number) => {
        let q: any = CreatorPage.find(query);
        if (select) q = q.select(select);
        if (sort) q = q.sort(sort);
        if (limit !== undefined) q = q.limit(limit);
        return q.lean();
    },

    findOne: (query: Record<string, unknown>, select?: string) => {
        let q: any = CreatorPage.findOne(query);
        if (select) q = q.select(select);
        return q;
    },

    findOnePopulated: (query: Record<string, unknown>, populateField: string, populateSelect: string) => {
        return CreatorPage.findOne(query).populate(populateField, populateSelect).lean();
    },

    findById: (id: string | Types.ObjectId, select?: string) => {
        let q: any = CreatorPage.findById(id);
        if (select) q = q.select(select);
        return q;
    },
    
    create: (data: Record<string, unknown>) => {
        return CreatorPage.create(data);
    },

    updateOne: (query: Record<string, unknown>, update: Record<string, unknown>) => {
        return CreatorPage.updateOne(query, update);
    },

    updateByUserId: (userId: string | Types.ObjectId, update: Record<string, unknown>) => {
        return CreatorPage.findOneAndUpdate({ userId }, update, { new: true }).lean();
    },

    findOneAndUpdateUpsert: (query: Record<string, unknown>, updateConfig: Record<string, unknown>) => {
        return CreatorPage.findOneAndUpdate(
            query,
            updateConfig,
            { new: true, runValidators: true, upsert: true, setDefaultsOnInsert: true }
        );
    }
};
