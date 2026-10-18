import mongoose, { Schema, Document } from 'mongoose';
import { ICreatorPage, PageTheme } from '../types/index.js';

export interface ICreatorPageDocument extends Omit<ICreatorPage, '_id'>, Document { }

const pageThemeSchema = new Schema<PageTheme>(
    {
        primaryColor: {
            type: String,
            default: '#6366f1', // Indigo
        },
        accentColor: {
            type: String,
            default: '#ec4899', // Pink
        },
        layout: {
            type: String,
            enum: ['default', 'minimal', 'featured'],
            default: 'default',
        },
    },
    { _id: false }
);

const youtubeVerificationSchema = new Schema(
    {
        channelId: { type: String, default: null },
        channelName: { type: String, default: null },
        thumbnail: { type: String, default: null },
        isVerified: { type: Boolean, default: false },
    },
    { _id: false }
);

const creatorPageSchema = new Schema<ICreatorPageDocument>(
    {
        userId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            unique: true,
        },
        pageSlug: {
            type: String,
            required: [true, 'Page slug is required'],
            unique: true,
            lowercase: true,
            trim: true,
            minlength: 3,
            maxlength: 50,
            match: [/^[a-z0-9_-]+$/, 'Slug can only contain lowercase letters, numbers, underscores, and hyphens'],
        },
        displayName: {
            type: String,
            required: [true, 'Display name is required'],
            trim: true,
            minlength: 2,
            maxlength: 100,
        },
        tagline: {
            type: String,
            default: '',
            maxlength: 500,
        },
        category: {
            type: [String],
            default: [],
        },
        avatarUrl: {
            type: String,
            default: null,
        },
        bannerUrl: {
            type: String,
            default: null,
        },
        about: {
            type: String,
            default: '',
            maxlength: 10000,
        },
        theme: {
            type: pageThemeSchema,
            default: () => ({}),
        },
        youtube: {
            type: youtubeVerificationSchema,
            default: undefined,
        },
        isPublic: {
            type: Boolean,
            default: true,
        },
        status: {
            type: String,
            enum: ['draft', 'published'],
            default: 'draft',
        },
        memberCount: {
            type: Number,
            default: 0,
            min: 0,
        },
        postCount: {
            type: Number,
            default: 0,
            min: 0,
        },
        activeLiveSessionId: {
            type: Schema.Types.ObjectId,
            ref: 'LiveSession',
            default: null,
        },
    },
    {
        timestamps: true,
    }
);

// Indexes
creatorPageSchema.index({ isPublic: 1, status: 1, memberCount: -1, createdAt: -1 });
creatorPageSchema.index({ isPublic: 1 });
creatorPageSchema.index({ memberCount: -1 });
creatorPageSchema.index({ createdAt: -1 });

const CreatorPage = mongoose.model<ICreatorPageDocument>('CreatorPage', creatorPageSchema);

export default CreatorPage;
