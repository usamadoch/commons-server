import { Types } from 'mongoose';
import { postRepository } from '../repositories/postRepository.js';
import { creatorPageRepository } from '../repositories/creatorPageRepository.js';
import { memberRepository } from '../repositories/memberRepository.js';
import { postLikeRepository } from '../repositories/postLikeRepository.js';
import { postViewRepository } from '../repositories/postViewRepository.js';
import { postViewDedupRepository } from '../repositories/postViewDedupRepository.js';
import { commentRepository } from '../repositories/commentRepository.js';
import PollVote from '../models/PollVote.js';
import { addNotificationJob } from '../jobs/queues.js';
import { muxService } from './media/muxService.js';
import MediaAsset from '../models/MediaAsset.js';
import { addMediaCleanupJob } from '../jobs/queues.js';
import { createError } from '../middleware/errorHandler.js';
import { sanitizePostForClient } from '../utils/postSanitizer.js';
import { AccessContext } from '../utils/postAccessControl.js';
import { cacheService, cacheKeys } from '../config/redis.js';

export const postCrudService = {
    async getPostById(postId: string, userId: string | null) {
        const post = await postRepository.findByIdPopulated(postId);
        if (!post) throw createError.notFound('Post');

        const creatorId = typeof post.creatorId === 'object' && (post.creatorId as any)._id
            ? (post.creatorId as any)._id.toString()
            : post.creatorId.toString();

        const isOwner = userId !== null && userId.toString() === creatorId;

        let isMember = false;
        if (post.visibility === 'members' && !isOwner && userId) {
            isMember = !!(await memberRepository.exists({
                memberId: userId,
                creatorId,
                status: 'active',
            }));
        }

        const ctx: AccessContext = { userId, isOwner, isMember };

        let isLiked = false;
        let userVotedOptions: number[] | undefined = undefined;
        if (userId) {
            isLiked = !!(await postLikeRepository.exists({ postId: post._id, userId }));
            const pollVote = await PollVote.findOne({ postId: post._id, userId });
            if (pollVote) {
                userVotedOptions = pollVote.optionIndexes;
            }
        }

        const sanitizedPost = sanitizePostForClient(post, ctx);
        return {
            post: { 
                ...sanitizedPost, 
                viewCount: post.viewCount || 0, 
                isLiked,
                ...(userVotedOptions ? { userVotedOptions } : {})
            },
            isLiked
        };
    },

    async recordPostView(postId: string, userId: string | null, visitorId: string) {
        if (!Types.ObjectId.isValid(postId)) {
            throw createError.invalidInput('Invalid post ID');
        }

        const post = await postRepository.findById(postId, '_id creatorId status viewCount');
        if (!post) throw createError.notFound('Post');

        // Only published posts may record public views
        if (post.status !== 'published') {
            throw createError.notFound('Post');
        }

        // Creators do not count views of their own posts
        const postCreatorId = typeof post.creatorId === 'object' && (post.creatorId as any)._id
            ? (post.creatorId as any)._id.toString()
            : post.creatorId.toString();

        if (userId && postCreatorId === userId.toString()) {
            return { recorded: false, viewCount: post.viewCount || 0 };
        }

        const viewerKey = userId ? `u:${userId}` : `v:${visitorId}`;
        const now = new Date();
        const twelveHoursMs = 12 * 60 * 60 * 1000;
        const twelveHoursAgo = new Date(now.getTime() - twelveHoursMs);
        const newExpiresAt = new Date(now.getTime() + twelveHoursMs);

        let isNewView = false;

        // Step 1: Attempt atomic update on an expired cooldown record
        const refreshed = await postViewDedupRepository.findOneAndUpdate(
            {
                postId: post._id,
                viewerKey,
                viewedAt: { $lt: twelveHoursAgo },
            },
            {
                $set: {
                    viewedAt: now,
                    expiresAt: newExpiresAt,
                },
            },
            { new: true }
        );

        if (refreshed) {
            isNewView = true;
        } else {
            // Step 2: Attempt to insert a new dedup record
            try {
                await postViewDedupRepository.create({
                    postId: post._id,
                    viewerKey,
                    viewedAt: now,
                    expiresAt: newExpiresAt,
                });
                isNewView = true;
            } catch (error: any) {
                if (error.code === 11000) {
                    // Unique constraint violation: duplicate request within active cooldown
                    return { recorded: false, viewCount: post.viewCount || 0 };
                }
                throw error;
            }
        }

        if (isNewView) {
            await Promise.all([
                postRepository.updateOne({ _id: post._id }, { $inc: { viewCount: 1 } }),
                postViewRepository.create({
                    postId: post._id,
                    userId: userId ? new Types.ObjectId(userId) : null,
                    sessionId: viewerKey,
                    viewedAt: now,
                    duration: 0,
                }),
            ]);
            return { recorded: true, viewCount: (post.viewCount || 0) + 1 };
        }

        return { recorded: false, viewCount: post.viewCount || 0 };
    },

    async createPost(userId: string | Types.ObjectId, data: any, io: any) {
        const creatorPage = await creatorPageRepository.findOne({ userId }, '_id displayName pageSlug');
        if (!creatorPage) throw createError.notFound('Creator page');

        const attachments = data.mediaAttachments || [];
        for (const attachment of attachments) {
            if (attachment.type === 'video' && attachment.muxUploadId && !attachment.url) {
                try {
                    const upload = await muxService.getUpload(attachment.muxUploadId);
                    if (upload && upload.status === 'asset_created' && upload.asset_id) {
                        const asset = await muxService.getAsset(upload.asset_id);
                        if (asset.status === 'ready') {
                            attachment.status = 'ready';
                            attachment.muxAssetId = asset.id;
                            attachment.duration = asset.duration;
                            const playbackId = asset.playback_ids?.[0]?.id;
                            if (playbackId) {
                                attachment.muxPlaybackId = playbackId;
                                attachment.url = `https://stream.mux.com/${playbackId}.m3u8`;
                                attachment.thumbnailUrl = `https://image.mux.com/${playbackId}/thumbnail.png`;
                            }
                        } else if (asset.status === 'errored') {
                            attachment.status = 'errored';
                        }
                    }
                } catch (err) {
                    console.error('Error pre-fetching Mux asset', err);
                }
            }
        }

        let sanitizedPoll = data.poll;
        if (sanitizedPoll && Array.isArray(sanitizedPoll.options)) {
            sanitizedPoll = {
                ...sanitizedPoll,
                totalVotes: 0,
                options: sanitizedPoll.options.map((o: any) => ({
                    text: typeof o === 'string' ? o : o.text,
                    votes: 0
                }))
            };
        }

        const post = await postRepository.create({
            ...data,
            poll: sanitizedPoll,
            mediaAttachments: attachments,
            creatorId: userId,
            pageId: creatorPage._id,
            publishedAt: data.status === 'published' ? new Date() : null,
        });

        const cloudinaryPublicIds = attachments
            .filter((a: any) => a.type === 'image' && a.cloudinaryPublicId)
            .map((a: any) => a.cloudinaryPublicId);

        if (cloudinaryPublicIds.length > 0) {
            await MediaAsset.updateMany(
                { cloudinaryPublicId: { $in: cloudinaryPublicIds }, uploadedBy: userId },
                { status: 'attached', refType: 'Post', refId: post._id }
            );
        }

        if (post.status === 'published') {
            await creatorPageRepository.updateOne({ _id: creatorPage._id }, { $inc: { postCount: 1 } });

            // Invalidate cached public feed and creator page so stats update immediately
            cacheService.invalidatePattern(cacheKeys.creatorFeedPattern(creatorPage.pageSlug)).catch(() => {});
            cacheService.del(cacheKeys.creatorPage(creatorPage.pageSlug)).catch(() => {});

            const members = await memberRepository.find({ creatorId: userId, status: 'active' }, 'memberId');
            if (members.length > 0) {
                const recipientIds = members.map((m: any) => m.memberId.toString());
                const previewText = post.caption ? (post.caption.substring(0, 80) + (post.caption.length > 80 ? '...' : '')) : 'Active check it out!';
                addNotificationJob({
                    recipientIds,
                    type: 'new_post',
                    title: 'New post!',
                    body: `${creatorPage.displayName} posted: ${previewText}`,
                    actionUrl: `/posts/${post._id}`,
                    actionLabel: 'View post',
                    metadata: { postId: post._id.toString(), creatorId: userId.toString() },
                }).catch(err => console.error('[PostCrudService] Failed to enqueue new_post notification', err));
            }
        }
        return post;
    },

    async updatePost(userId: string | Types.ObjectId, postId: string, data: any, io: any) {
        const post = await postRepository.findOne({ _id: postId, creatorId: userId });
        if (!post) throw createError.notFound('Post');

        const wasPublished = post.status === 'published';
        const updateData = { ...data };
        if (!wasPublished && data.status === 'published') {
            updateData.publishedAt = new Date();
        }

        const updatedPost = await postRepository.findByIdAndUpdateNew(postId, updateData);

        if (!wasPublished && updatedPost && updatedPost.status === 'published') {
            // Post transitioning draft -> published: increment postCount & invalidate cache
            const page = await creatorPageRepository.findById(updatedPost.pageId, '_id displayName pageSlug');
            if (page) {
                await creatorPageRepository.updateOne({ _id: page._id }, { $inc: { postCount: 1 } });
                cacheService.invalidatePattern(cacheKeys.creatorFeedPattern(page.pageSlug)).catch(() => {});
                cacheService.del(cacheKeys.creatorPage(page.pageSlug)).catch(() => {});

                const members = await memberRepository.find({ creatorId: userId, status: 'active' }, 'memberId');
                if (members.length > 0) {
                    const recipientIds = members.map((m: any) => m.memberId.toString());
                    const previewText = updatedPost.caption ? (updatedPost.caption.substring(0, 80) + (updatedPost.caption.length > 80 ? '...' : '')) : 'Active check it out!';
                    addNotificationJob({
                        recipientIds,
                        type: 'new_post',
                        title: 'New post!',
                        body: `${page.displayName} posted: ${previewText}`,
                        actionUrl: `/posts/${updatedPost._id}`,
                        actionLabel: 'View post',
                        metadata: { postId: updatedPost._id.toString(), creatorId: userId.toString() },
                    }).catch(err => console.error('[PostCrudService] Failed to enqueue new_post notification', err));
                }
            }
        } else if (wasPublished && updatedPost && updatedPost.status !== 'published') {
            // Post transitioning published -> draft/archived: decrement postCount & invalidate cache
            const page = await creatorPageRepository.findById(updatedPost.pageId, '_id pageSlug');
            if (page) {
                await creatorPageRepository.updateOne(
                    { _id: page._id, postCount: { $gt: 0 } },
                    { $inc: { postCount: -1 } }
                );
                cacheService.invalidatePattern(cacheKeys.creatorFeedPattern(page.pageSlug)).catch(() => {});
                cacheService.del(cacheKeys.creatorPage(page.pageSlug)).catch(() => {});
            }
        } else if (updatedPost) {
            // Any other edit on an existing post: invalidate cached feed
            const page = await creatorPageRepository.findById(updatedPost.pageId, '_id pageSlug');
            if (page) {
                cacheService.invalidatePattern(cacheKeys.creatorFeedPattern(page.pageSlug)).catch(() => {});
            }
        }

        return updatedPost;
    },

    async deletePost(userId: string | Types.ObjectId, postId: string) {
        const post = await postRepository.findOneAndDelete({ _id: postId, creatorId: userId });
        if (!post) throw createError.notFound('Post');

        if (post.status === 'published') {
            await creatorPageRepository.updateOne(
                { _id: post.pageId, postCount: { $gt: 0 } },
                { $inc: { postCount: -1 } }
            );
        }

        const page = await creatorPageRepository.findById(post.pageId, '_id pageSlug');
        if (page) {
            cacheService.invalidatePattern(cacheKeys.creatorFeedPattern(page.pageSlug)).catch(() => {});
            cacheService.del(cacheKeys.creatorPage(page.pageSlug)).catch(() => {});
        }

        Promise.all([
            postLikeRepository.deleteMany({ postId: post._id }),
            postViewRepository.deleteMany({ postId: post._id }),
            postViewDedupRepository.deleteMany({ postId: post._id }),
            commentRepository.deleteMany({ postId: post._id }),
        ]).catch(err => console.error(`[PostCrudService] Failed to perform cascading deletes for post ${post._id}`, err));

        if (post.mediaAttachments && post.mediaAttachments.length > 0) {
            post.mediaAttachments.forEach((attachment: any) => {
                if (attachment.type === 'image' && attachment.cloudinaryPublicId) {
                    addMediaCleanupJob({ type: 'image', publicId: attachment.cloudinaryPublicId }).catch(err =>
                        console.error('Failed to enqueue image media cleanup job', err)
                    );
                } else if (attachment.type === 'video' && attachment.muxAssetId) {
                    addMediaCleanupJob({ type: 'video', muxAssetId: attachment.muxAssetId }).catch(err =>
                        console.error('Failed to enqueue video media cleanup job', err)
                    );
                }
            });
        }
    }
};
