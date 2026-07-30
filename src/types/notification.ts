import { Types } from 'mongoose';

export type NotificationType =
    | 'new_member'
    | 'member_left'
    | 'new_post'
    | 'post_liked'
    | 'new_comment'
    | 'comment_reply'
    | 'new_message'
    | 'creator_went_live'
    | 'system';

export interface BaseNotificationMetadata {
    [key: string]: unknown;
}

export interface NewMessageMetadata extends BaseNotificationMetadata {
    conversationId: string;
    messageCount: number;
}

export interface AggregatedNotificationMetadata extends BaseNotificationMetadata {
    count: number;
}

export type NotificationMetadata =
    | NewMessageMetadata
    | AggregatedNotificationMetadata
    | BaseNotificationMetadata;

export interface INotification {
    _id: Types.ObjectId;
    recipientId: Types.ObjectId;
    type: NotificationType;
    title: string;
    body: string;
    imageUrl: string | null;
    actionUrl: string;
    actionLabel: string;
    metadata: NotificationMetadata;
    dedupeKey: string | null;
    isRead: boolean;
    readAt: Date | null;
    createdAt: Date;
    expiresAt: Date | null;
    updatedAt: Date;
}
