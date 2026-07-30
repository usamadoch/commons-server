import { Types } from 'mongoose';

export interface PageTheme {
    primaryColor: string;
    accentColor: string;
    layout: 'default' | 'minimal' | 'featured';
}

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
