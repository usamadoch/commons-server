import mongoose, { Schema, Document } from 'mongoose';

export interface ICommentLikeDocument extends Document {
    commentId: mongoose.Types.ObjectId;
    userId: mongoose.Types.ObjectId;
    createdAt: Date;
    updatedAt: Date;
}

const commentLikeSchema = new Schema<ICommentLikeDocument>(
    {
        commentId: {
            type: Schema.Types.ObjectId,
            ref: 'Comment',
            required: true,
        },
        userId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
    },
    {
        timestamps: true,
    }
);

// A user can only like a specific comment once
commentLikeSchema.index({ commentId: 1, userId: 1 }, { unique: true });
commentLikeSchema.index({ userId: 1 });

const CommentLike = mongoose.model<ICommentLikeDocument>('CommentLike', commentLikeSchema);

export default CommentLike;
