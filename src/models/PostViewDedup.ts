import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IPostViewDedupDocument extends Document {
    postId: Types.ObjectId;
    viewerKey: string;
    viewedAt: Date;
    expiresAt: Date;
}

const postViewDedupSchema = new Schema<IPostViewDedupDocument>(
    {
        postId: {
            type: Schema.Types.ObjectId,
            ref: 'Post',
            required: true,
        },
        viewerKey: {
            type: String,
            required: true,
        },
        viewedAt: {
            type: Date,
            required: true,
            default: Date.now,
        },
        expiresAt: {
            type: Date,
            required: true,
        },
    },
    {
        timestamps: true,
    }
);

// Compound unique index ensuring only 1 active cooldown entry per (post, viewer) and eliminating concurrency race conditions
postViewDedupSchema.index({ postId: 1, viewerKey: 1 }, { unique: true });

// TTL index to automatically prune expired records from the collection
postViewDedupSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const PostViewDedup = mongoose.model<IPostViewDedupDocument>('PostViewDedup', postViewDedupSchema);

export default PostViewDedup;
