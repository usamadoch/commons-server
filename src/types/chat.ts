import { Types } from 'mongoose';

export interface MessageAttachment {
    type: 'image' | 'file';
    url: string;
    filename: string;
    fileSize: number;
    mimeType: string;
}

export type MessageStatus = 'sent' | 'delivered' | 'read';

export interface IMessage {
    _id: Types.ObjectId;
    conversationId: Types.ObjectId;
    senderId: Types.ObjectId;
    content: string;
    contentType: 'text' | 'image' | 'file';
    attachments: MessageAttachment[];
    status: MessageStatus;
    readAt: Date | null;
    isDeleted: boolean;
    deletedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
}

export interface IConversation {
    _id: Types.ObjectId;
    participants: Types.ObjectId[];
    creatorId: Types.ObjectId;
    memberId: Types.ObjectId;
    isActive: boolean;
    lastMessage: {
        content: string;
        senderId: Types.ObjectId;
        sentAt: Date;
    } | null;
    unreadCounts: Record<string, number>;
    createdAt: Date;
    updatedAt: Date;
}
