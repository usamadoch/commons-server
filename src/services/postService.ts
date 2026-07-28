import { Types } from 'mongoose';
import { postRepository } from '../repositories/postRepository.js';
import { creatorPageRepository } from '../repositories/creatorPageRepository.js';
import { memberRepository } from '../repositories/memberRepository.js';
import { postLikeRepository } from '../repositories/postLikeRepository.js';
import { postViewRepository } from '../repositories/postViewRepository.js';
import { commentRepository } from '../repositories/commentRepository.js';
import { addNotificationJob } from '../jobs/queues.js';
import { cloudinaryService } from './media/cloudinaryService.js';
import { muxService } from './media/muxService.js';
import MediaAsset from '../models/MediaAsset.js';
import { addMediaCleanupJob } from '../jobs/queues.js';
import { createError } from '../middleware/errorHandler.js';
import { sanitizePostForClient, sanitizePostsForClient, AccessContext } from '../utils/postAccessControl.js';

export const postService = {
    async getMyPosts(userId: string | Types.ObjectId, page: number, limit: number) {
        const creatorPage = await creatorPageRepository.findOne({ userId }, '_id');
        if (!creatorPage) throw createError.notFound('Creator page');

        const query = { pageId: creatorPage._id, status: 'published' };
        const skip = (page - 1) * limit;

        const posts = await postRepository.find(
            query,
            '_id caption postType mediaAttachments.type mediaAttachments.url viewCount likeCount commentCount visibility publishedAt createdAt',
            { isPinned: -1, createdAt: -1 },
            skip,
            limit
        );

        const totalItems = await postRepository.countDocuments(query);
        const totalPages = Math.ceil(totalItems / limit);

        return {
            posts,
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
            '_id caption postType visibility viewCount likeCount commentCount creatorId createdAt isPinned mediaAttachments.type mediaAttachments.url mediaAttachments.thumbnailUrl mediaAttachments.duration mediaAttachments.cloudinaryPublicId mediaAttachments.muxPlaybackId mediaAttachments.filename mediaAttachments.fileSize mediaAttachments.mimeType mediaAttachments.dimensions mediaAttachments.status',
            { isPinned: -1, createdAt: -1 },
            undefined,
            limit
        );

        const membershipMap = new Map<string, boolean>();
        const likedPostIds = new Set<string>();

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
        }

        const sanitizedPosts = sanitizePostsForClient(posts, userId?.toString() || null, membershipMap);

        return sanitizedPosts.map(post => ({
            ...post,
            isLiked: likedPostIds.has(post._id.toString())
        }));
    },

    async getPostById(postId: string, userId: string | null, sessionId: string) {
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

        await Promise.all([
            postViewRepository.updateOne(
                { postId: post._id, sessionId },
                {
                    $set: { viewedAt: new Date() },
                    $setOnInsert: { userId: userId || null },
                },
                { upsert: true }
            ),
            postRepository.updateOne({ _id: post._id }, { $inc: { viewCount: 1 } })
        ]);

        let isLiked = false;
        if (userId) {
            isLiked = !!(await postLikeRepository.exists({ postId: post._id, userId }));
        }

        const sanitizedPost = sanitizePostForClient(post, ctx);
        return {
            post: { ...sanitizedPost, viewCount: (post.viewCount || 0) + 1, isLiked },
            isLiked
        };
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

        const post = await postRepository.create({
            ...data,
            mediaAttachments: attachments,
            creatorId: userId,
            pageId: creatorPage._id,
            publishedAt: data.status === 'published' ? new Date() : null,
        });

        // Attach media assets
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
                }).catch(err => console.error('[PostService] Failed to enqueue new_post notification', err));
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
                    }).catch(err => console.error('[PostService] Failed to enqueue new_post notification', err));
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

        // Fire-and-forget cleanup to prevent blocking the HTTP response
        Promise.all([
            postLikeRepository.deleteMany({ postId: post._id }),
            postViewRepository.deleteMany({ postId: post._id }),
            commentRepository.deleteMany({ postId: post._id }),
        ]).catch(err => console.error(`[PostService] Failed to perform cascading deletes for post ${post._id}`, err));

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
    },

    async toggleLikePost(userId: string | Types.ObjectId, postId: string, userDisplayName: string, io: any) {
        const existingLike = await postLikeRepository.exists({ postId, userId });

        if (existingLike) {
            const deleted = await postLikeRepository.findOneAndDelete({ postId, userId });
            if (deleted) {
                await postRepository.updateOne({ _id: postId, likeCount: { $gt: 0 } }, { $inc: { likeCount: -1 } });
            }
            const post = await postRepository.findById(postId, 'likeCount');
            return { liked: false, likeCount: post?.likeCount ?? 0 };
        } else {
            let isNewLike = false;
            try {
                await postLikeRepository.create({ postId, userId });
                isNewLike = true;
            } catch (err: any) {
                if (err.code !== 11000) throw err;
            }

            let post;
            if (isNewLike) {
                post = await postRepository.findByIdAndUpdateNew(postId, { $inc: { likeCount: 1 } });
            } else {
                post = await postRepository.findById(postId, 'likeCount creatorId');
            }

            if (isNewLike && post && post.creatorId.toString() !== userId.toString()) {
                addNotificationJob({
                    recipientId: post.creatorId.toString(),
                    type: 'post_liked',
                    title: 'Post liked',
                    body: `${userDisplayName} liked your post`,
                    actionUrl: `/posts/${postId}`,
                    actionLabel: 'View post',
                    metadata: { postId: postId.toString(), userId: userId.toString() },
                }).catch(err => console.error('[PostService] Failed to enqueue post_liked notification', err));
            }

            return { liked: true, likeCount: post?.likeCount ?? 0 };
        }
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
