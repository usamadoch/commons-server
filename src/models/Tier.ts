import mongoose, { Schema, Document } from 'mongoose';
import { ITier, TierStatus } from '../types/index.js';

export interface ITierDocument extends Omit<ITier, '_id'>, Document { }

const tierSchema = new Schema<ITierDocument>(
    {
        creatorId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
        pageId: {
            type: Schema.Types.ObjectId,
            ref: 'CreatorPage',
            required: true,
        },
        name: {
            type: String,
            required: [true, 'Plan name is required'],
            trim: true,
            maxlength: 100,
        },
        price: {
            type: Number,
            required: [true, 'Price is required'],
            min: [0, 'Price must be at least 0'],
        },
        description: {
            type: String,
            required: [true, 'Description is required'],
            trim: true,
            maxlength: 500,
        },
        benefits: {
            type: [String],
            default: [],
        },
        badgeTitle: {
            type: String,
            default: '',
            trim: true,
            maxlength: 50,
        },
        isHighlighted: {
            type: Boolean,
            default: false,
        },
        status: {
            type: String,
            enum: ['draft', 'published'] as TierStatus[],
            default: 'draft',
        },
        activeSubscribers: {
            type: Number,
            default: 0,
            min: 0,
        },
        safepayPlanId: {
            type: String,
            default: '',
        },
        safepayYearlyPlanId: {
            type: String,
            default: '',
        },
    },
    {
        timestamps: true,
    }
);

// Indexes
tierSchema.index({ creatorId: 1, status: 1, price: 1 });
tierSchema.index({ creatorId: 1 });
tierSchema.index({ pageId: 1 });
tierSchema.index({ status: 1 });
tierSchema.index({ createdAt: -1 });

const Tier = mongoose.model<ITierDocument>('Tier', tierSchema);

export default Tier;
