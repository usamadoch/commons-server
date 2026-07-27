import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IMediaAsset extends Document {
    cloudinaryPublicId: string;
    url: string;
    uploadedBy: Types.ObjectId;
    status: 'pending' | 'attached';
    refType?: 'Post' | 'User' | 'CreatorPage';
    refId?: Types.ObjectId;
    createdAt: Date;
    updatedAt: Date;
}

const mediaAssetSchema = new Schema<IMediaAsset>({
    cloudinaryPublicId: { 
        type: String, 
        required: true, 
        unique: true, 
        index: true 
    },
    url: { 
        type: String, 
        required: true 
    },
    uploadedBy: { 
        type: Schema.Types.ObjectId, 
        ref: 'User', 
        required: true, 
        index: true 
    },
    status: { 
        type: String, 
        enum: ['pending', 'attached'], 
        default: 'pending', 
        index: true 
    },
    refType: { 
        type: String, 
        enum: ['Post', 'User', 'CreatorPage'] 
    },
    refId: { 
        type: Schema.Types.ObjectId, 
        index: true 
    },
}, { 
    timestamps: true 
});

const MediaAsset = mongoose.model<IMediaAsset>('MediaAsset', mediaAssetSchema);
export default MediaAsset;
