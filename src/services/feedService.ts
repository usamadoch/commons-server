import { Types } from 'mongoose';
import { postRepository } from '../repositories/postRepository.js';
import { memberRepository } from '../repositories/memberRepository.js';
import { postLikeRepository } from '../repositories/postLikeRepository.js';
import { sanitizePostsForClient } from '../utils/postSanitizer.js';
import PollVote from '../models/PollVote.js';

export const feedService = {
    async getHomeFeed(userId: string | Types.ObjectId, cursor: string | undefined, limit: number) {
        const pageLimit = Math.min(Math.max(limit, 1), 50);

        const memberships = await memberRepository.find({ memberId: userId, status: 'active' }, 'pageId creatorId');
        if (memberships.length === 0) {
            return { posts: [], hasNextPage: false, nextCursor: null };
        }

        const subscribedPageIds = memberships.map((m: any) => m.pageId);
        const query: Record<string, unknown> = { pageId: { $in: subscribedPageIds }, status: 'published' };

        if (cursor) {
            query.publishedAt = { $lt: new Date(cursor) };
        }

        const posts = await postRepository.findNotLean(
            query,
            '_id caption postType visibility viewCount likeCount commentCount creatorId pageId createdAt publishedAt isPinned linkUrl poll mediaAttachments.type mediaAttachments.url mediaAttachments.thumbnailUrl mediaAttachments.duration mediaAttachments.cloudinaryPublicId mediaAttachments.muxPlaybackId mediaAttachments.filename mediaAttachments.fileSize mediaAttachments.mimeType mediaAttachments.dimensions mediaAttachments.status',
            { publishedAt: -1 },
            undefined,
            pageLimit + 1
        ).populate('pageId', 'displayName avatarUrl pageSlug');

        const hasNextPage = posts.length > pageLimit;
        const resultPosts = hasNextPage ? posts.slice(0, pageLimit) : posts;
        const nextCursor = hasNextPage && resultPosts.length > 0
            ? resultPosts[resultPosts.length - 1].publishedAt?.toISOString() || null
            : null;

        const membershipMap = new Map<string, boolean>();
        memberships.forEach((m: any) => membershipMap.set(m.creatorId.toString(), true));

        const likedPostIds = new Set<string>();
        const likes = await postLikeRepository.find({
            userId,
            postId: { $in: resultPosts.map((p: any) => p._id) },
        }, 'postId');

        likes.forEach((like: any) => likedPostIds.add(like.postId.toString()));
        
        const pollVotes = await PollVote.find({
            userId,
            postId: { $in: resultPosts.map((p: any) => p._id) },
        });
        const votedPollsMap = new Map<string, number[]>();
        pollVotes.forEach((vote: any) => votedPollsMap.set(vote.postId.toString(), vote.optionIndexes));

        const sanitizedPosts = sanitizePostsForClient(resultPosts, userId.toString(), membershipMap);
        const postsWithLikes = sanitizedPosts.map((post: any) => ({
            ...post,
            isLiked: likedPostIds.has(post._id.toString()),
            ...(votedPollsMap.has(post._id.toString()) ? { userVotedOptions: votedPollsMap.get(post._id.toString()) } : {})
        }));

        return { posts: postsWithLikes, hasNextPage, nextCursor };
    }
};
