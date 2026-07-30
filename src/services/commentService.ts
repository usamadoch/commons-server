import { Types } from 'mongoose';
import { postRepository } from '../repositories/postRepository.js';
import { memberRepository } from '../repositories/memberRepository.js';
import { commentRepository } from '../repositories/commentRepository.js';
import { commentLikeRepository } from '../repositories/commentLikeRepository.js';
import { checkPostAccess } from './postAccessService.js';
import { addNotificationJob } from '../jobs/queues.js';
import { createError } from '../middleware/errorHandler.js';

export const commentService = {
    async getPostComments(postId: string, page: number, limit: number, userId?: string | Types.ObjectId) {
        const post = await postRepository.findById(postId, 'visibility status creatorId');
        if (!post) throw createError.notFound('Post');

        await checkPostAccess(post, userId);

        const query = { postId, parentId: null, isHidden: false };
        const comments = await commentRepository.find(
            query,
            { path: 'authorId', select: 'displayName username avatarUrl' },
            { isPinned: -1, createdAt: -1 },
            (page - 1) * limit,
            limit
        );

        const totalItems = await commentRepository.countDocuments(query);
        const totalPages = Math.ceil(totalItems / limit);

        let commentsList = comments.map((c: any) => c.toJSON ? c.toJSON() : c);
        if (userId) {
            const commentIds = commentsList.map((c: any) => c._id);
            const likes = await commentLikeRepository.find({
                commentId: { $in: commentIds },
                userId
            });
            const likedCommentIds = new Set(likes.map((like: any) => like.commentId.toString()));
            
            commentsList = commentsList.map((c: any) => ({
                ...c,
                isLiked: likedCommentIds.has(c._id.toString())
            }));
        }

        return {
            comments: commentsList,
            meta: {
                pagination: {
                    page,
                    limit,
                    totalItems,
                    totalPages,
                    hasNextPage: page * limit < totalItems,
                    hasPrevPage: page > 1,
                }
            }
        };
    },

    async addPostComment(userId: string | Types.ObjectId, userDisplayName: string, postId: string, content: string, parentId: string | null, io: any) {
        const post = await postRepository.findById(postId);
        if (!post) throw createError.notFound('Post');
        
        await checkPostAccess(post, userId);

        if (!post.allowComments) throw createError.forbidden('Comments are disabled for this post');

        let depth = 0;
        if (parentId) {
            const parent = await commentRepository.findById(parentId);
            if (parent) {
                depth = Math.min(parent.depth + 1, 3);
            }
        }

        const comment = await commentRepository.create({
            postId,
            authorId: userId,
            content,
            parentId: parentId || null,
            depth,
        });

        if (parentId) {
            await commentRepository.updateOne({ _id: parentId }, { $inc: { replyCount: 1 } });
        }

        await postRepository.updateOne({ _id: post._id }, { $inc: { commentCount: 1 } });

        if (post.creatorId.toString() !== userId.toString()) {
            addNotificationJob({
                recipientId: post.creatorId.toString(),
                type: 'new_comment',
                title: 'New comment',
                body: `${userDisplayName} commented on your post`,
                actionUrl: `/posts/${post._id}#comment-${comment._id}`,
                actionLabel: 'View comment',
                metadata: { postId: post._id.toString(), commentId: comment._id.toString(), userId: userId.toString() },
            }).catch(err => console.error('[CommentService] Failed to enqueue new_comment notification', err));
        }

        await comment.populate('authorId', 'displayName username avatarUrl');
        return comment;
    },

    async toggleLikeComment(userId: string | Types.ObjectId, commentId: string, userDisplayName: string, io: any) {
        const comment = await commentRepository.findById(commentId);
        if (!comment) throw createError.notFound('Comment');

        const post = await postRepository.findById(comment.postId, 'visibility status creatorId');
        if (post) await checkPostAccess(post, userId);

        const existingLike = await commentLikeRepository.exists({ commentId, userId });

        if (existingLike) {
            const deleted = await commentLikeRepository.findOneAndDelete({ commentId, userId });
            if (deleted) {
                await commentRepository.updateOne({ _id: commentId, likeCount: { $gt: 0 } }, { $inc: { likeCount: -1 } });
            }
            const updatedComment = await commentRepository.findById(commentId, 'likeCount');
            return { liked: false, likeCount: updatedComment?.likeCount ?? 0 };
        } else {
            let isNewLike = false;
            try {
                await commentLikeRepository.create({ commentId, userId });
                isNewLike = true;
            } catch (err: any) {
                if (err.code !== 11000) throw err;
            }

            let updatedComment;
            if (isNewLike) {
                updatedComment = await commentRepository.findByIdAndUpdateNew(commentId, { $inc: { likeCount: 1 } });
            } else {
                updatedComment = await commentRepository.findById(commentId, 'likeCount authorId');
            }

            return { liked: true, likeCount: updatedComment?.likeCount ?? 0 };
        }
    }
};
