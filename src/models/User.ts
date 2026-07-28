import mongoose, { Schema, Document } from 'mongoose';
import bcrypt from 'bcryptjs';
import { IUser, NotificationPreferences, UserRole, ONBOARDING_STEPS } from '../types/index.js';

export interface IUserDocument extends Omit<IUser, '_id'>, Document {
    comparePassword(candidatePassword: string): Promise<boolean>;
}


const userSchema = new Schema<IUserDocument>(
    {
        email: {
            type: String,
            required: [true, 'Email is required'],
            unique: true,
            lowercase: true,
            trim: true,
            match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email'],
        },
        passwordHash: {
            type: String,
            required: [true, 'Password is required'],
            minlength: 8,
            select: false,
        },
        role: {
            type: String,
            enum: ['member', 'creator', 'admin'] as UserRole[],
            default: 'member',
            required: true,
        },
        displayName: {
            type: String,
            required: [true, 'Display name is required'],
            trim: true,
            minlength: 2,
            maxlength: 100,
        },
        username: {
            type: String,
            required: [true, 'Username is required'],
            unique: true,
            lowercase: true,
            trim: true,
            minlength: 3,
            maxlength: 30,
            match: [/^[a-z0-9_-]+$/, 'Username can only contain letters, numbers, underscores, and hyphens'],
        },
        bio: {
            type: String,
            default: '',
            maxlength: 500,
        },
        avatarUrl: {
            type: String,
            default: null,
        },
        isEmailVerified: {
            type: Boolean,
            default: false,
        },
        isActive: {
            type: Boolean,
            default: true,
        },
        lastLoginAt: {
            type: Date,
            default: null,
        },
        googleId: {
            type: String,
            sparse: true,
        },
        onboardingStep: {
            type: Number,
            default: ONBOARDING_STEPS.NOT_STARTED,
            min: ONBOARDING_STEPS.NOT_STARTED,
            max: ONBOARDING_STEPS.COMPLETE,
        },
        notificationPreferences: {
            email: {
                newMembers: { type: Boolean, default: true },
                newComments: { type: Boolean, default: true },
                newMessages: { type: Boolean, default: true },
                newPosts: { type: Boolean, default: true },
            },
            push: {
                newMembers: { type: Boolean, default: true },
                newPosts: { type: Boolean, default: true },
                newComments: { type: Boolean, default: true },
                newMessages: { type: Boolean, default: true },
            },
            inApp: {
                all: { type: Boolean, default: true },
            },
            quietHours: {
                enabled: { type: Boolean, default: false },
                startTime: { type: String, default: '22:00' },
                endTime: { type: String, default: '08:00' },
                timezone: { type: String, default: 'UTC' },
            },
        },
        safepayCustomerToken: { type: String, default: null },
        safepayPaymentMethodToken: { type: String, default: null },
    },
    {
        timestamps: true,
    }
);

// Hash password before saving
userSchema.pre('save', async function () {
    const doc = this as unknown as IUserDocument;
    if (!doc.isModified('passwordHash')) {
        return;
    }

    const salt = await bcrypt.genSalt(12);
    doc.passwordHash = await bcrypt.hash(doc.passwordHash, salt);
});

// Compare password method
userSchema.methods.comparePassword = async function (candidatePassword: string): Promise<boolean> {
    return bcrypt.compare(candidatePassword, this.passwordHash);
};



userSchema.index({ createdAt: -1 });
const User = mongoose.model<IUserDocument>('User', userSchema);

export default User;
