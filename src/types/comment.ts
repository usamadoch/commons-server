import { Types } from 'mongoose';

export interface IComment {
    _id: Types.ObjectId;
    postId: Types.ObjectId;
    authorId: Types.ObjectId;
    content: string;
    parentId: Types.ObjectId | null;
    depth: number;
    isEdited: boolean;
    isPinned: boolean;
    isHidden: boolean;
    likeCount: number;
    replyCount: number;
    createdAt: Date;
    updatedAt: Date;
}
