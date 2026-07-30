import { Types } from 'mongoose';
import { MediaAttachment, LockedMediaAttachment } from './media.js';
import { IPoll } from './poll.js';

export type PostType = 'text' | 'image' | 'video'; 
export type PostStatus = 'draft' | 'scheduled' | 'published';
export type PostVisibility = 'public' | 'members';

export interface IPost {
    _id: Types.ObjectId;
    creatorId: Types.ObjectId;
    pageId: Types.ObjectId;
    caption: string;
    mediaAttachments: MediaAttachment[];
    postType: PostType;
    tags: string[];
    visibility: PostVisibility;
    status: PostStatus;
    publishedAt: Date | null;
    scheduledFor: Date | null;
    viewCount: number;
    likeCount: number;
    commentCount: number;
    allowComments: boolean;
    isPinned: boolean;
    linkUrl?: string;
    poll?: IPoll;
    userVotedOptions?: number[];
    createdAt: Date;
    updatedAt: Date;
}

export interface LinkPreview {
    isEmbeddable: boolean;
    domainLabel: string;
    thumbnailUrl?: string;
}

export interface UnlockedPostResponse extends Omit<IPost, '_id' | 'creatorId' | 'pageId'> {
    _id: Types.ObjectId | string;
    creatorId: Types.ObjectId | string | { _id: string; displayName?: string; username?: string; avatarUrl?: string | null };
    pageId: Types.ObjectId | string | { _id: string; pageSlug: string; displayName?: string; avatarUrl?: string | null };
    isLocked: false;
}

export interface LockedPostResponse extends Omit<IPost, '_id' | 'creatorId' | 'pageId' | 'caption' | 'mediaAttachments'> {
    _id: Types.ObjectId | string;
    creatorId: Types.ObjectId | string | { _id: string; displayName?: string; username?: string; avatarUrl?: string | null };
    pageId: Types.ObjectId | string | { _id: string; pageSlug: string; displayName?: string; avatarUrl?: string | null };
    caption: null;
    teaser: string;
    mediaAttachments: LockedMediaAttachment[];
    isLocked: true;
    linkPreview?: LinkPreview;
}

export type SanitizedPostResponse = UnlockedPostResponse | LockedPostResponse;
