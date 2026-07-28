import { Request } from 'express';
import { Types } from 'mongoose';

// User types
export type UserRole = 'member' | 'creator' | 'admin';

// Onboarding step: strict literal union representing each stage of creator onboarding.
// 0 = not started, 1 = account created, 2 = details done, 3 = category done, 4 = complete
export type OnboardingStep = 0 | 1 | 2 | 3 | 4;

export const ONBOARDING_STEPS = {
    NOT_STARTED: 0 as const,
    ACCOUNT_CREATED: 1 as const,
    DETAILS_DONE: 2 as const,
    CATEGORY_DONE: 3 as const,
    COMPLETE: 4 as const,
};

export type Permission =
    | 'post:create'
    | 'post:read'
    | 'post:update'
    | 'post:delete'
    | 'dashboard:view'
    | 'analytics:view'
    | 'members:view'
    | 'payouts:view'
    | 'page:manage'
    | 'explore:view'
    | 'subscriptions:view'
    | 'security:manage'
    | 'admin:access';

export interface IUser {
    _id: Types.ObjectId;
    email: string;
    passwordHash: string;
    role: UserRole;
    displayName: string;
    username: string;
    bio: string;
    avatarUrl: string | null;
    isEmailVerified: boolean;
    isActive: boolean;
    lastLoginAt: Date;
    googleId?: string; // Optional: Only present for Google-authenticated users
    onboardingStep: OnboardingStep;
    notificationPreferences: NotificationPreferences;
    safepayCustomerToken?: string;
    safepayPaymentMethodToken?: string;
    createdAt: Date;
    updatedAt: Date;
}

export interface NotificationPreferences {
    email: {
        newMembers: boolean;
        newComments: boolean;
        newMessages: boolean;
        newPosts: boolean;
    };
    push: {
        newMembers: boolean;
        newPosts: boolean;
        newComments: boolean;
        newMessages: boolean;
    };
    inApp: {
        all: boolean;
    };
    quietHours: {
        enabled: boolean;
        startTime: string;
        endTime: string;
        timezone: string;
    };
}


// Page theme
export interface PageTheme {
    primaryColor: string;
    accentColor: string;
    layout: 'default' | 'minimal' | 'featured';
}

// Creator page
export interface ICreatorPage {
    _id: Types.ObjectId;
    userId: Types.ObjectId;
    pageSlug: string;
    displayName: string;
    tagline: string;
    category: string[];
    avatarUrl: string | null;
    bannerUrl: string | null;
    about: string;
    theme: PageTheme;
    youtube?: {
        channelId: string;
        channelName: string;
        thumbnail: string;
        isVerified: boolean;
    };
    isPublic: boolean;
    memberCount: number;
    postCount: number;
    activeLiveSessionId?: Types.ObjectId | null;
    status: 'draft' | 'published';
    createdAt: Date;
    updatedAt: Date;
}

// Post types
export type PostType = 'text' | 'image' | 'video'; // Audio/poll/link removed as per request
export type PostStatus = 'draft' | 'scheduled' | 'published';
export type PostVisibility = 'public' | 'members';

export interface BaseMediaAttachment {
    url: string;
    filename: string;
    fileSize: number;
    mimeType: string;
    dimensions?: { width: number; height: number };
}

export type MediaStatus = 'preparing' | 'ready' | 'errored';

export interface ImageAttachment extends BaseMediaAttachment {
    type: 'image';
    cloudinaryPublicId?: string; // Optional for migration, required for new
}

export interface VideoAttachment extends BaseMediaAttachment {
    type: 'video';
    muxUploadId?: string;
    muxAssetId?: string;
    muxPlaybackId?: string;
    status?: MediaStatus;
    thumbnailUrl: string; // Required for videos
    duration: number;     // Required for videos
}

export type MediaAttachment = ImageAttachment | VideoAttachment;

export interface IPost {
    _id: Types.ObjectId;
    creatorId: Types.ObjectId;
    pageId: Types.ObjectId;
    caption: string;
    // featuredImage removed
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
    createdAt: Date;
    updatedAt: Date;
}

// ============================================================================
// SANITIZED POST RESPONSE TYPES (Access-Controlled Responses)
// ============================================================================

/**
 * Locked media attachment - original URLs are nulled, only blurred previews
 */
export interface LockedImageAttachment {
    type: 'image';
    url: null;
    thumbnailUrl: string | null;
    filename: string;
    fileSize: number;
    mimeType: string;
    dimensions?: { width: number; height: number };
}

export interface LockedVideoAttachment {
    type: 'video';
    url: null;
    thumbnailUrl: string | null;
    filename: string;
    fileSize: number;
    mimeType: string;
    dimensions?: { width: number; height: number };
    muxPlaybackId: null;
    muxAssetId: null;
    duration?: number;
    status?: MediaStatus;
}

export type LockedMediaAttachment = LockedImageAttachment | LockedVideoAttachment;

/**
 * Post with full access - user is authorized to see all content
 */
export interface UnlockedPostResponse extends Omit<IPost, '_id' | 'creatorId' | 'pageId'> {
    _id: Types.ObjectId | string;
    creatorId: Types.ObjectId | string | { _id: string; displayName?: string; username?: string; avatarUrl?: string | null };
    pageId: Types.ObjectId | string | { _id: string; pageSlug: string; displayName?: string; avatarUrl?: string | null };
    isLocked: false;
}

/**
 * Post with locked access - sensitive content is redacted
 */
export interface LockedPostResponse extends Omit<IPost, '_id' | 'creatorId' | 'pageId' | 'caption' | 'mediaAttachments'> {
    _id: Types.ObjectId | string;
    creatorId: Types.ObjectId | string | { _id: string; displayName?: string; username?: string; avatarUrl?: string | null };
    pageId: Types.ObjectId | string | { _id: string; pageSlug: string; displayName?: string; avatarUrl?: string | null };
    caption: null;                      // Redacted
    teaser: string;                     // Short preview or static message
    mediaAttachments: LockedMediaAttachment[];
    isLocked: true;
}

/**
 * Discriminated union for type-safe handling of post responses
 */
export type SanitizedPostResponse = UnlockedPostResponse | LockedPostResponse;

// Member
export type MembershipStatus = 'active' | 'paused' | 'cancelled';

export interface IMember {
    _id: Types.ObjectId;
    memberId: Types.ObjectId;
    creatorId: Types.ObjectId;
    pageId: Types.ObjectId;
    tier?: string;
    status: MembershipStatus;
    joinedAt: Date;
    cancelledAt: Date | null;
    lastVisitAt: Date;
    totalVisits: number;
}

// Payout Method
export type PayoutStatus = 'pending_review' | 'approved' | 'rejected';
export type IdType = 'id_card' | 'driving_license' | 'passport';

export interface IPayoutMethod {
    _id: Types.ObjectId;
    userId: Types.ObjectId;
    pageId: Types.ObjectId;

    firstName: string;
    lastName: string;
    dateOfBirth: string;
    address1: string;
    address2?: string;
    city: string;
    postalCode: string;

    bankName: string;
    accountHolderName: string;
    iban: string;
    idType: IdType;
    idNumber: string;

    status: PayoutStatus;
    rejectionReason?: string;
    reviewedBy?: Types.ObjectId;
    reviewedAt?: Date;
    createdAt: Date;
    updatedAt: Date;
}

// Member Plan
export type TierStatus = 'draft' | 'published';

export interface ITier {
    _id: Types.ObjectId;
    creatorId: Types.ObjectId;
    pageId: Types.ObjectId;
    name: string;
    price: number;
    description: string;
    benefits: string[];
    badgeTitle?: string;
    isHighlighted: boolean;
    status: TierStatus;
    activeSubscribers: number;
    safepayPlanId?: string;
    safepayYearlyPlanId?: string;
    createdAt: Date;
    updatedAt: Date;
}

// Subscription
export type SubscriptionStatus = 'active' | 'past_due' | 'canceled' | 'incomplete';

export interface ISubscription {
    _id: Types.ObjectId;
    userId: Types.ObjectId;
    creatorId: Types.ObjectId;
    planId: Types.ObjectId;
    status: SubscriptionStatus;
    currentPeriodStart?: Date;
    currentPeriodEnd?: Date;
    canceledAt?: Date;
    safepaySubscriptionId?: string;
    interval?: 'MONTHLY' | 'YEARLY';
    createdAt: Date;
    updatedAt: Date;
}

// Messages
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

// Notifications
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

// Comments
export interface IComment {
    _id: Types.ObjectId;
    postId: Types.ObjectId;
    authorId: Types.ObjectId;
    content: string;
    parentId: Types.ObjectId | null;
    depth: number;
    isEdited: boolean;
    isPinned: boolean;
    isHidden: boolean;
    likeCount: number;
    replyCount: number;
    createdAt: Date;
    updatedAt: Date;
}

// Auth request extension
export interface AuthenticatedRequest extends Request {
    user: IUser; // Required: This interface serves requests where auth is guaranteed
}

export interface MaybeAuthenticatedRequest extends Request {
    user?: IUser;
}

// API Response types
export interface SuccessResponse<T> {
    success: true;
    data: T;
    meta?: {
        pagination?: Pagination;
        [key: string]: unknown;
    };
}

export interface ErrorResponse {
    success: false;
    error: {
        code: string;
        message: string;
        details?: Record<string, string[]>;
    };
}

export interface Pagination {
    page: number;
    limit: number;
    totalItems: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPrevPage: boolean;
}

// JWT Payload
export interface JWTPayload {
    userId: string;
    email: string;
    role: UserRole;
}

// Refresh token
export interface IRefreshToken {
    _id: Types.ObjectId;
    userId: Types.ObjectId;
    token: string;
    expiresAt: Date;
    createdAt: Date;
}

export interface UploadedFile {
    url: string;
    filename: string;
    fileSize: number;
    mimeType: string;
}


export * from './analytics.js';

// Transaction types
export type TransactionStatus = 'pending' | 'available' | 'refunded' | 'paid' | 'completed' | 'failed';
export type TransactionType = 'subscription' | 'refund' | 'superchat';

export interface ITransaction {
    _id: Types.ObjectId;
    userId: Types.ObjectId;
    creatorId: Types.ObjectId;
    pageId: Types.ObjectId;
    type: TransactionType;
    gross: number;
    platformFee: number;
    net: number;
    status: TransactionStatus;
    releaseAt: Date;
    payoutId?: Types.ObjectId;
    description?: string;
    createdAt: Date;
    updatedAt: Date;
}
