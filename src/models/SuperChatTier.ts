import mongoose, { Schema, Document } from 'mongoose';

export interface ISuperChatTier {
    tierLevel: number;
    tierLabel: string;
    minAmount: number;
    bgColor: string;
    textareaBg: string;
    textColor: string;
    maxLength: number;
    pinTimeMinutes: number;
    pinTimeLabel: string | null;
    canMessage: boolean;
    textDark: boolean;
    isActive: boolean;
}

export interface ISuperChatTierDocument extends ISuperChatTier, Document { }

const superChatTierSchema = new Schema<ISuperChatTierDocument>(
    {
        tierLevel: { type: Number, required: true },
        tierLabel: { type: String, required: true },
        minAmount: { type: Number, required: true, unique: true },
        bgColor: { type: String, required: true },
        textareaBg: { type: String, required: true },
        textColor: { type: String, required: true },
        maxLength: { type: Number, required: true },
        pinTimeMinutes: { type: Number, required: true },
        pinTimeLabel: { type: String, default: null },
        canMessage: { type: Boolean, required: true },
        textDark: { type: Boolean, required: true },
        isActive: { type: Boolean, default: true },
    },
    {
        timestamps: true,
    }
);

// Indexes
superChatTierSchema.index({ isActive: 1 });

const SuperChatTier = mongoose.model<ISuperChatTierDocument>('SuperChatTier', superChatTierSchema);

export default SuperChatTier;
