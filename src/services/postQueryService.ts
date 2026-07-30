import { Types } from 'mongoose';
import { postRepository } from '../repositories/postRepository.js';
import { creatorPageRepository } from '../repositories/creatorPageRepository.js';
import { memberRepository } from '../repositories/memberRepository.js';
import { postLikeRepository } from '../repositories/postLikeRepository.js';
import PollVote from '../models/PollVote.js';
import { createError } from '../middleware/errorHandler.js';
import { sanitizePostsForClient } from '../utils/postSanitizer.js';

export const postQueryService = {
    async getMyPosts(userId: string | Types.ObjectId, page: number, limit: number) {
        const creatorPage = await creatorPageRepository.findOne({ userId }, '_id');
        if (!creatorPage) throw createError.notFound('Creator page');

        const query = { pageId: creatorPage._id, status: 'published' };
        const skip = (page - 1) * limit;

        const posts = await postRepository.find(
            query,
            '_id caption postType linkUrl poll mediaAttachments.type mediaAttachments.url viewCount likeCount commentCount visibility publishedAt createdAt',
            { isPinned: -1, createdAt: -1 },
            skip,
            limit
        );

        const totalItems = await postRepository.countDocuments(query);
        const totalPages = Math.ceil(totalItems / limit);

        const pollVotes = await PollVote.find({
            userId,
            postId: { $in: posts.map((p: any) => p._id) }
        });
        const votedPollsMap = new Map<string, number[]>();
        pollVotes.forEach((vote: any) => votedPollsMap.set(vote.postId.toString(), vote.optionIndexes));

        return {
            posts: posts.map((post: any) => {
                const postObj = post.toObject ? post.toObject() : post;
                return {
                    ...postObj,
                    ...(votedPollsMap.has(post._id.toString()) ? { userVotedOptions: votedPollsMap.get(post._id.toString()) } : {})
                };
            }),
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

    async getCreatorPosts(pageSlug: string, limit: number, type?: string, userId?: string | Types.ObjectId) {
        const creatorPage = await creatorPageRepository.findOne({ pageSlug: pageSlug.toLowerCase() }, '_id');
        if (!creatorPage) throw createError.notFound('Creator page');

        const query: Record<string, unknown> = {
            pageId: creatorPage._id,
            status: 'published',
        };

        if (type) {
            const types = type.split(',');
            query.postType = types.length === 1 ? types[0] : { $in: types };
        }

        const posts = await postRepository.findNotLean(
            query,
            '_id caption postType visibility viewCount likeCount commentCount creatorId createdAt isPinned linkUrl poll mediaAttachments.type mediaAttachments.url mediaAttachments.thumbnailUrl mediaAttachments.duration mediaAttachments.cloudinaryPublicId mediaAttachments.muxPlaybackId mediaAttachments.filename mediaAttachments.fileSize mediaAttachments.mimeType mediaAttachments.dimensions mediaAttachments.status',
            { isPinned: -1, createdAt: -1 },
            undefined,
            limit
        );

        const membershipMap = new Map<string, boolean>();
        const likedPostIds = new Set<string>();
        const votedPollsMap = new Map<string, number[]>();

        if (userId) {
            const creatorIds = [...new Set(posts.map((p: any) => {
                const cId = p.creatorId as any;
                return typeof cId === 'object' && cId._id ? cId._id.toString() : cId.toString();
            }))];

            const members = await memberRepository.find({
                memberId: userId,
                creatorId: { $in: creatorIds },
                status: 'active',
            }, 'creatorId');

            members.forEach((m: any) => membershipMap.set(m.creatorId.toString(), true));

            const likes = await postLikeRepository.find({
                userId,
                postId: { $in: posts.map((p: any) => p._id) }
            }, 'postId');

            likes.forEach((like: any) => likedPostIds.add(like.postId.toString()));
            
            const pollVotes = await PollVote.find({
                userId,
                postId: { $in: posts.map((p: any) => p._id) }
            });
            
            pollVotes.forEach((vote: any) => votedPollsMap.set(vote.postId.toString(), vote.optionIndexes));
        }

        const sanitizedPosts = sanitizePostsForClient(posts, userId?.toString() || null, membershipMap);

        return sanitizedPosts.map(post => ({
            ...post,
            isLiked: likedPostIds.has(post._id.toString()),
            ...(votedPollsMap.has(post._id.toString()) ? { userVotedOptions: votedPollsMap.get(post._id.toString()) } : {})
        }));
    },

    async getRecentVideos(pageSlug: string, limit: number) {
        const creatorPage = await creatorPageRepository.findOne({ pageSlug: pageSlug.toLowerCase() }, '_id');
        if (!creatorPage) throw createError.notFound('Creator page');

        return postRepository.findNotLean(
            { pageId: creatorPage._id, postType: 'video', status: 'published' },
            'caption teaser mediaAttachments.thumbnailUrl mediaAttachments.duration mediaAttachments.type publishedAt createdAt _id',
            { publishedAt: -1, createdAt: -1 },
            undefined,
            limit
        );
    }
};
