import { Types } from 'mongoose';
import { postRepository } from '../repositories/postRepository.js';
import { postLikeRepository } from '../repositories/postLikeRepository.js';
import PollVote from '../models/PollVote.js';
import Post from '../models/Post.js';
import { addNotificationJob } from '../jobs/queues.js';
import { createError } from '../middleware/errorHandler.js';
import { sanitizePostForClient } from '../utils/postSanitizer.js';
import { checkPostAccess } from './postAccessService.js';

export const postInteractionService = {
    async toggleLikePost(userId: string | Types.ObjectId, postId: string, userDisplayName: string, io: any) {
        const post = await postRepository.findById(postId, 'visibility status creatorId');
        if (!post) throw createError.notFound('Post');
        await checkPostAccess(post, userId);

        const existingLike = await postLikeRepository.exists({ postId, userId });

        if (existingLike) {
            const deleted = await postLikeRepository.findOneAndDelete({ postId, userId });
            if (deleted) {
                await postRepository.updateOne({ _id: postId, likeCount: { $gt: 0 } }, { $inc: { likeCount: -1 } });
            }

            if (post.creatorId.toString() !== userId.toString()) {
                addNotificationJob({
                    recipientId: post.creatorId.toString(),
                    type: 'post_liked',
                    title: 'Post liked',
                    body: '', 
                    actionUrl: `/posts/${postId}`,
                    actionLabel: 'View post',
                    metadata: { postId: postId.toString(), userId: userId.toString(), action: 'remove' },
                }).catch(err => console.error('[PostInteractionService] Failed to enqueue post_unliked notification', err));
            }

            const updatedPost = await postRepository.findById(postId, 'likeCount');
            return { liked: false, likeCount: updatedPost?.likeCount ?? 0 };
        } else {
            let isNewLike = false;
            try {
                await postLikeRepository.create({ postId, userId });
                isNewLike = true;
            } catch (err: any) {
                if (err.code !== 11000) throw err;
            }

            let postRef;
            if (isNewLike) {
                postRef = await postRepository.findByIdAndUpdateNew(postId, { $inc: { likeCount: 1 } });
            } else {
                postRef = await postRepository.findById(postId, 'likeCount creatorId');
            }

            if (isNewLike && postRef && postRef.creatorId.toString() !== userId.toString()) {
                addNotificationJob({
                    recipientId: postRef.creatorId.toString(),
                    type: 'post_liked',
                    title: 'Post liked',
                    body: `${userDisplayName} liked your post`,
                    actionUrl: `/posts/${postId}`,
                    actionLabel: 'View post',
                    metadata: { postId: postId.toString(), userId: userId.toString() },
                }).catch(err => console.error('[PostInteractionService] Failed to enqueue post_liked notification', err));
            }

            return { liked: true, likeCount: postRef?.likeCount ?? 0 };
        }
    },

    async votePoll(userId: string | Types.ObjectId, postId: string, optionIndexes: number[]) {
        const post = await postRepository.findById(postId);
        if (!post) throw createError.notFound('Post');
        if (!post.poll) throw createError.invalidInput('Post does not have a poll');

        await checkPostAccess(post, userId);
        
        const pollOptions = post.poll.options || [];
        const uniqueOptionIndexes = [...new Set(optionIndexes)];
        
        for (const index of uniqueOptionIndexes) {
            if (index < 0 || index >= pollOptions.length) {
                throw createError.invalidInput('Invalid option index');
            }
        }
        
        if (!post.poll.allowMultiple && uniqueOptionIndexes.length > 1) {
            throw createError.invalidInput('Multiple options not allowed for this poll');
        }
        
        const existingVote = await PollVote.findOne({ postId, userId });
        const oldIndexes = existingVote ? existingVote.optionIndexes : [];
        const isChangingVote = !!existingVote;

        if (isChangingVote && JSON.stringify([...oldIndexes].sort()) === JSON.stringify([...uniqueOptionIndexes].sort())) {
            const sanitizedPostForReturn = sanitizePostForClient(post, {
                userId: userId.toString(),
                isOwner: post.creatorId.toString() === userId.toString(),
                isMember: true,
            });
            return { post: sanitizedPostForReturn, userVotedOptions: uniqueOptionIndexes };
        }
        
        const incUpdate: Record<string, number> = {};
        
        if (isChangingVote) {
            for (const idx of oldIndexes) {
                const key = `poll.options.${idx}.votes`;
                incUpdate[key] = (incUpdate[key] || 0) - 1;
            }
        }
        
        for (const idx of uniqueOptionIndexes) {
            const key = `poll.options.${idx}.votes`;
            incUpdate[key] = (incUpdate[key] || 0) + 1;
        }
        
        if (!isChangingVote && uniqueOptionIndexes.length > 0) {
            incUpdate['poll.totalVotes'] = 1;
        } else if (isChangingVote) {
            if (oldIndexes.length > 0 && uniqueOptionIndexes.length === 0) {
                incUpdate['poll.totalVotes'] = -1;
            } else if (oldIndexes.length === 0 && uniqueOptionIndexes.length > 0) {
                incUpdate['poll.totalVotes'] = 1;
            }
        }

        if (Object.keys(incUpdate).length > 0) {
            await Post.updateOne({ _id: postId }, { $inc: incUpdate });
        }

        if (existingVote) {
            if (uniqueOptionIndexes.length === 0 && !post.poll.allowMultiple) {
                existingVote.optionIndexes = [];
            } else {
                existingVote.optionIndexes = uniqueOptionIndexes;
            }
            await existingVote.save();
        } else if (uniqueOptionIndexes.length > 0) {
            await PollVote.create({ postId, userId, optionIndexes: uniqueOptionIndexes });
        }

        const updatedPost = await postRepository.findById(postId);
        if (!updatedPost) throw createError.notFound('Post');
        const sanitizedPostForReturn = sanitizePostForClient(updatedPost, {
            userId: userId.toString(),
            isOwner: updatedPost.creatorId.toString() === userId.toString(),
            isMember: true,
        });
        return { post: sanitizedPostForReturn, userVotedOptions: uniqueOptionIndexes };
    }
};
