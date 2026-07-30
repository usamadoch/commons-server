import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IPollVote extends Document {
    postId: Types.ObjectId;
    userId: Types.ObjectId;
    optionIndexes: number[];
    createdAt: Date;
    updatedAt: Date;
}

const pollVoteSchema = new Schema<IPollVote>({
    postId: {
        type: Schema.Types.ObjectId,
        ref: 'Post',
        required: true,
        index: true
    },
    userId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    optionIndexes: [{
        type: Number,
        required: true
    }]
}, {
    timestamps: true
});

pollVoteSchema.index({ postId: 1, userId: 1 }, { unique: true });

const PollVote = mongoose.model<IPollVote>('PollVote', pollVoteSchema);

export default PollVote;
