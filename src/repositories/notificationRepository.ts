import Notification from '../models/Notification.js';
import { Types } from 'mongoose';

export const notificationRepository = {
    find: (query: Record<string, unknown>, sort?: Record<string, -1 | 1>, skip?: number, limit?: number) => {
        let q: any = Notification.find(query);
        if (sort) q = q.sort(sort);
        if (skip !== undefined) q = q.skip(skip);
        if (limit !== undefined) q = q.limit(limit);
        return q;
    },

    countDocuments: (query: Record<string, unknown>) => {
        return Notification.countDocuments(query);
    },

    findOneAndUpdate: (query: Record<string, unknown>, update: Record<string, unknown>) => {
        return Notification.findOneAndUpdate(query, update, { new: true });
    },

    updateMany: (query: Record<string, unknown>, update: Record<string, unknown>) => {
        return Notification.updateMany(query, update);
    },

    findOneAndDelete: (query: Record<string, unknown>) => {
        return Notification.findOneAndDelete(query);
    },

    findOne: (query: Record<string, unknown>) => {
        return Notification.findOne(query);
    },

    create: (data: Record<string, unknown>) => {
        return Notification.create(data);
    },

    insertMany: (data: any[]) => {
        return Notification.insertMany(data);
    },

    /**
     * Atomic upsert using dedupeKey. If the key exists (and notification is unread),
     * increment the count and update body/title. Otherwise insert a new doc.
     * Returns the upserted/updated document.
     */
    upsertByDedupeKey: async (
        dedupeKey: string,
        insertData: Record<string, unknown>,
        updateBody: string,
        updateTitle?: string
    ) => {
        const { metadata, ...rest } = insertData;
        const setOnInsert: Record<string, unknown> = { ...rest, dedupeKey };
        
        if (metadata && typeof metadata === 'object') {
            for (const [k, v] of Object.entries(metadata)) {
                if (k !== 'count') {
                    setOnInsert[`metadata.${k}`] = v;
                }
            }
        }

        const update: Record<string, unknown> = {
            $inc: { 'metadata.count': 1 },
            $set: { body: updateBody, updatedAt: new Date(), isRead: false },
            $setOnInsert: setOnInsert,
        };
        
        if (updateTitle) {
            (update.$set as Record<string, unknown>).title = updateTitle;
        }

        // Prevent MongoDB conflict: cannot have the same path in $set and $setOnInsert
        const setKeys = Object.keys(update.$set as Record<string, unknown>);
        for (const key of setKeys) {
            delete (update.$setOnInsert as Record<string, unknown>)[key];
        }

        return Notification.findOneAndUpdate(
            { dedupeKey },
            update,
            { new: true, upsert: true }
        );
    },

    /**
     * Aggregates a list of users for a notification.
     * Uses $addToSet or $pull on metadata.userIds.
     */
    aggregateUsersByDedupeKey: async (
        dedupeKey: string,
        userId: string,
        action: 'add' | 'remove',
        insertData: Record<string, unknown>
    ) => {
        const { metadata, ...rest } = insertData;
        const setOnInsert: Record<string, unknown> = { ...rest, dedupeKey };
        
        if (metadata && typeof metadata === 'object') {
            for (const [k, v] of Object.entries(metadata)) {
                if (k !== 'userIds') {
                    setOnInsert[`metadata.${k}`] = v;
                }
            }
        }

        const update: Record<string, unknown> = {
            $set: { updatedAt: new Date() },
        };

        if (action === 'add') {
            update.$addToSet = { 'metadata.userIds': userId };
            (update.$set as any).isRead = false;
            update.$setOnInsert = setOnInsert;
            
            // Clean up setOnInsert overlaps with $set
            const setKeys = Object.keys(update.$set as Record<string, unknown>);
            for (const key of setKeys) {
                delete (update.$setOnInsert as Record<string, unknown>)[key];
            }
        } else {
            update.$pull = { 'metadata.userIds': userId };
        }

        return Notification.findOneAndUpdate(
            { dedupeKey },
            update,
            { new: true, upsert: action === 'add' }
        );
    }
};
