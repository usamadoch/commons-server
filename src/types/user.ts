import { Types } from 'mongoose';

export type UserRole = 'member' | 'creator' | 'admin';

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
    googleId?: string;
    onboardingStep: OnboardingStep;
    notificationPreferences: NotificationPreferences;
    safepayCustomerToken?: string;
    safepayPaymentMethodToken?: string;
    createdAt: Date;
    updatedAt: Date;
}
