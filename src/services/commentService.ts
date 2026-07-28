import { Types } from 'mongoose';
import { postRepository } from '../repositories/postRepository.js';
import { memberRepository } from '../repositories/memberRepository.js';
import { commentRepository } from '../repositories/commentRepository.js';
import { addNotificationJob } from '../jobs/queues.js';
import { createError } from '../middleware/errorHandler.js';

export const commentService = {
    async getPostComments(postId: string, page: number, limit: number, userId?: string | Types.ObjectId) {
        const post = await postRepository.findById(postId, 'visibility status creatorId');
        if (!post) throw createError.notFound('Post');

        if (post.visibility === 'members' && post.status === 'published') {
            if (!userId) throw createError.unauthorized('Authentication required to view comments');

            const isOwner = userId.toString() === post.creatorId.toString();
            if (!isOwner) {
                const member = await memberRepository.findOne({
                    memberId: userId,
                    creatorId: post.creatorId,
                    status: 'active',
                });
                if (!member) throw createError.forbidden('Members only content');
            }
        }

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

        return {
            comments,
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
                metadata: { postId: post._id.toString(), commentId: comment._id.toString() },
            }).catch(err => console.error('[CommentService] Failed to enqueue new_comment notification', err));
        }

        await comment.populate('authorId', 'displayName username avatarUrl');
        return comment;
    }
};
