import { Types } from 'mongoose';
import { postRepository } from '../repositories/postRepository.js';
import { creatorPageRepository } from '../repositories/creatorPageRepository.js';
import { memberRepository } from '../repositories/memberRepository.js';
import { postLikeRepository } from '../repositories/postLikeRepository.js';
import { postViewRepository } from '../repositories/postViewRepository.js';
import { commentRepository } from '../repositories/commentRepository.js';
import PollVote from '../models/PollVote.js';
import { addNotificationJob } from '../jobs/queues.js';
import { muxService } from './media/muxService.js';
import MediaAsset from '../models/MediaAsset.js';
import { addMediaCleanupJob } from '../jobs/queues.js';
import { createError } from '../middleware/errorHandler.js';
import { sanitizePostForClient } from '../utils/postSanitizer.js';
import { AccessContext } from '../utils/postAccessControl.js';

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

    async recordPostView(postId: string, userId: string | null, sessionId: string) {
        const post = await postRepository.findById(postId, '_id viewCount');
        if (!post) throw createError.notFound('Post');

        // Deduplication query: check if this user or session already viewed the post within the last 12 hours
        const query: Record<string, unknown> = { postId: post._id };
        if (userId) {
            query.userId = userId;
        } else {
            query.sessionId = sessionId;
        }

        const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000);
        const existingView = await postViewRepository.findOne({
            ...query,
            viewedAt: { $gte: twelveHoursAgo }
        });

        if (!existingView) {
            await Promise.all([
                postViewRepository.updateOne(
                    query,
                    {
                        $set: { viewedAt: new Date() },
                        $setOnInsert: { userId: userId || null, sessionId },
                    },
                    { upsert: true }
                ),
                postRepository.updateOne({ _id: post._id }, { $inc: { viewCount: 1 } })
            ]);
            return { recorded: true, viewCount: (post.viewCount || 0) + 1 };
        }

        return { recorded: false, viewCount: post.viewCount || 0 };
    },

    async createPost(userId: string | Types.ObjectId, data: any, io: any) {
        const creatorPage = await creatorPageRepository.findOne({ userId }, '_id displayName');
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
            const page = await creatorPageRepository.findById(updatedPost.pageId, '_id displayName');
            if (page) {
                await creatorPageRepository.updateOne({ _id: page._id }, { $inc: { postCount: 1 } });

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
        }

        return updatedPost;
    },

    async deletePost(userId: string | Types.ObjectId, postId: string) {
        const post = await postRepository.findOneAndDelete({ _id: postId, creatorId: userId });
        if (!post) throw createError.notFound('Post');

        if (post.status === 'published') {
            await creatorPageRepository.updateOne({ _id: post.pageId }, { $inc: { postCount: -1 } });
        }

        Promise.all([
            postLikeRepository.deleteMany({ postId: post._id }),
            postViewRepository.deleteMany({ postId: post._id }),
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
