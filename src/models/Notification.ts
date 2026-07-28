import mongoose, { Schema, Document } from 'mongoose';
import { INotification, NotificationType } from '../types/index.js';

export interface INotificationDocument extends Omit<INotification, '_id'>, Document { }

const notificationSchema = new Schema<INotificationDocument>(
    {
        recipientId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
        type: {
            type: String,
            enum: [
                'new_member',
                'member_left',
                'new_post',
                'post_liked',
                'new_comment',
                'comment_reply',
                'new_message',
                'creator_went_live',
                'system',
            ] as NotificationType[],
            required: true,
        },
        title: {
            type: String,
            required: true,
            maxlength: 100,
        },
        body: {
            type: String,
            required: true,
            maxlength: 500,
        },
        imageUrl: {
            type: String,
            default: null,
        },
        actionUrl: {
            type: String,
            required: true,
        },
        actionLabel: {
            type: String,
            default: 'View',
        },
        metadata: {
            type: Schema.Types.Mixed,
            default: {},
        },
        isRead: {
            type: Boolean,
            default: false,
        },
        readAt: {
            type: Date,
            default: null,
        },
        expiresAt: {
            type: Date,
            default: null,
        },
        dedupeKey: {
            type: String,
            default: null,
        },
    },
    {
        timestamps: true,
    }
);

// Indexes
notificationSchema.index({ recipientId: 1, isRead: 1, createdAt: -1 });
notificationSchema.index({ recipientId: 1, createdAt: -1 });
notificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
notificationSchema.index({ dedupeKey: 1 }, { unique: true, sparse: true });

const Notification = mongoose.model<INotificationDocument>('Notification', notificationSchema);

export default Notification;
