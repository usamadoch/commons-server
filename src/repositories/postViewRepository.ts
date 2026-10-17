import PostView from '../models/PostView.js';

export const postViewRepository = {
    countDocuments: (query: Record<string, unknown>) => {
        return PostView.countDocuments(query);
    },

    updateOne: (query: Record<string, unknown>, update: Record<string, unknown>, options?: Record<string, unknown>) => {
        return PostView.updateOne(query, update, options);
    },

    findOne: (query: Record<string, unknown>) => {
        return PostView.findOne(query);
    },

    deleteMany: (query: Record<string, unknown>) => {
        return PostView.deleteMany(query);
    }
};

