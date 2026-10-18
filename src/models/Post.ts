import mongoose, { Schema, Document } from 'mongoose';
import { IPost, MediaAttachment, PostType, PostStatus, PostVisibility } from '../types/index.js';

export interface IPostDocument extends Omit<IPost, '_id'>, Document { }

const mediaAttachmentSchema = new Schema<MediaAttachment>(
    {
        type: {
            type: String,
            enum: ['image', 'video'],
            required: true,
        },
        url: {
            type: String,
            required: false, // For Mux videos, URL is populated by webhook after upload
        },
        thumbnailUrl: String,
        filename: {
            type: String,
            required: true,
        },
        fileSize: {
            type: Number,
            required: true,
        },
        mimeType: {
            type: String,
            required: true,
        },
        duration: Number,
        dimensions: {
            width: Number,
            height: Number,
        },
        // Cloudinary fields
        cloudinaryPublicId: String,
        // Mux fields
        muxUploadId: String,
        muxAssetId: String,
        muxPlaybackId: String,
        status: {
            type: String,
            enum: ['preparing', 'ready', 'errored'],
            default: undefined
        }
    },
    { _id: false }
);

// EditorJS block schema removed


const postSchema = new Schema<IPostDocument>(
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
        caption: {
            type: String,
            required: [true, 'Caption is required'],
            trim: true,
            maxlength: 2200,
        },
        // Content, Title, and FeaturedImage removed
        mediaAttachments: {
            type: [mediaAttachmentSchema],
            default: [],
        },
        postType: {
            type: String,
            enum: ['text', 'image', 'video'] as PostType[],
            default: 'text',
        },
        tags: {
            type: [String],
            default: [],
            validate: [
                (val: string[]) => val.length <= 10,
                'Maximum 10 tags allowed',
            ],
        },
        visibility: {
            type: String,
            enum: ['public', 'members'] as PostVisibility[],
            default: 'public',
        },
        status: {
            type: String,
            enum: ['draft', 'scheduled', 'published'] as PostStatus[],
            default: 'draft',
        },
        publishedAt: {
            type: Date,
            default: null,
        },
        scheduledFor: {
            type: Date,
            default: null,
        },
        viewCount: {
            type: Number,
            default: 0,
            min: 0,
        },
        likeCount: {
            type: Number,
            default: 0,
            min: 0,
        },
        commentCount: {
            type: Number,
            default: 0,
            min: 0,
        },
        allowComments: {
            type: Boolean,
            default: true,
        },
        isPinned: {
            type: Boolean,
            default: false,
        },
        linkUrl: {
            type: String,
        },
        poll: {
            type: Schema.Types.Mixed,
        },
    },
    {
        timestamps: true,
    }
);

// Set publishedAt when status changes to published
postSchema.pre('save', function () {
    if (this.isModified('status') && this.status === 'published' && !this.publishedAt) {
        this.publishedAt = new Date();
    }
});

// Indexes
postSchema.index({ creatorId: 1, status: 1 });
postSchema.index({ pageId: 1, status: 1, isPinned: -1, createdAt: -1 });
postSchema.index({ pageId: 1, status: 1, publishedAt: -1 });
postSchema.index({ visibility: 1, status: 1, publishedAt: -1 });
postSchema.index({ tags: 1 });
postSchema.index({ createdAt: -1 });
postSchema.index({ publishedAt: -1 });
postSchema.index({ viewCount: -1 });
postSchema.index({ likeCount: -1 });
// Mux webhook lookup indexes
postSchema.index({ "mediaAttachments.muxUploadId": 1 });
postSchema.index({ "mediaAttachments.muxAssetId": 1 });

const Post = mongoose.model<IPostDocument>('Post', postSchema);

export default Post;
