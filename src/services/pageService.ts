import { creatorPageRepository } from '../repositories/creatorPageRepository.js';
import { postRepository } from '../repositories/postRepository.js';
import { memberRepository } from '../repositories/memberRepository.js';
import { createError } from '../middleware/errorHandler.js';
import { UpdatePageInput } from '../utils/validators.js';
import { Types } from 'mongoose';
import { mediaLifecycleService } from './media/mediaLifecycleService.js';

export const pageService = {
    async getPublicPages() {
        const pages = await creatorPageRepository.find(
            { isPublic: true, status: 'published' },
            'pageSlug displayName tagline avatarUrl memberCount postCount activeLiveSessionId',
            { memberCount: -1, createdAt: -1 },
            50
        );
        return pages;
    },

    async getMyPage(userId: string | Types.ObjectId) {
        const page = await creatorPageRepository.findOne({ userId });
        if (!page) {
            throw createError.notFound('Page');
        }
        return page;
    },

    async updateMyPage(userId: string | Types.ObjectId, updateData: UpdatePageInput & { avatarUrl?: string, bannerUrl?: string }) {
        const oldPage = await creatorPageRepository.findOne({ userId });

        const updateConfig = {
            $set: updateData,
            $setOnInsert: { userId }
        };
        const page = await creatorPageRepository.findOneAndUpdateUpsert({ userId }, updateConfig);

        // Handle avatar lifecycle if it changed
        if (updateData.avatarUrl && oldPage && oldPage.avatarUrl !== updateData.avatarUrl) {
            await mediaLifecycleService.handleImageReplacement(
                oldPage.avatarUrl,
                updateData.avatarUrl,
                userId,
                'Page',
                page._id
            );
        }

        // Handle banner lifecycle if it changed
        if (updateData.bannerUrl && oldPage && oldPage.bannerUrl !== updateData.bannerUrl) {
            await mediaLifecycleService.handleImageReplacement(
                oldPage.bannerUrl,
                updateData.bannerUrl,
                userId,
                'Page',
                page._id
            );
        }

        return page;
    },

    async getPageBySlug(slug: string, currentUserId?: string | Types.ObjectId) {
        const _slug = slug.toLowerCase();
        const page = await creatorPageRepository.findOnePopulated(
            { pageSlug: _slug },
            'userId',
            'displayName username avatarUrl'
        );

        if (!page) {
            throw createError.notFound('Page');
        }

        let isMember = false;
        let isOwner = false;

        // Auto-fix post count if out of sync
        const realPostCount = await postRepository.countDocuments({
            pageId: page._id,
            status: 'published'
        });

        if (page.postCount !== realPostCount) {
            console.log(`[Page] Fixing post count for ${page.pageSlug}: ${page.postCount} -> ${realPostCount}`);
            await creatorPageRepository.updateOne({ _id: page._id }, { postCount: realPostCount });
            page.postCount = realPostCount;
        }

        if (currentUserId) {
            const pageOwnerIdStr = (page.userId as any)._id ? (page.userId as any)._id.toString() : page.userId.toString();
            isOwner = pageOwnerIdStr === currentUserId.toString();

            if (!isOwner) {
                const membershipExists = await memberRepository.exists({
                    memberId: currentUserId,
                    creatorId: (page.userId as any)._id || page.userId,
                    status: 'active',
                });
                isMember = !!membershipExists;
            }
        }

        // Draft pages are returned normally — the `status` field is included
        // in the response so the client can handle display logic (e.g., DraftBanner).
        // We don't block here because server-side callers (Next.js SSR) can't
        // forward browser auth cookies to determine ownership.

        if (!page.isPublic && !isOwner && !isMember) {
            return {
                page: {
                    _id: page._id,
                    pageSlug: page.pageSlug,
                    displayName: page.displayName,
                    tagline: page.tagline,
                    avatarUrl: page.avatarUrl,
                    bannerUrl: page.bannerUrl,
                    memberCount: page.memberCount,
                    isPublic: page.isPublic,
                    activeLiveSessionId: page.activeLiveSessionId,
                },
                isOwner: false,
                isMember: false,
                isRestricted: true,
            };
        }

        return { page, isOwner, isMember, isRestricted: false };
    },

    async getPagePosts(pageId: string, currentUserId?: string | Types.ObjectId) {
        const page = await creatorPageRepository.findById(pageId);
        if (!page) {
            throw createError.notFound('Page');
        }

        let isMember = false;
        let isOwner = false;

        if (currentUserId) {
            isOwner = page.userId.toString() === currentUserId.toString();

            if (!isOwner) {
                const membershipExists = await memberRepository.exists({
                    memberId: currentUserId,
                    pageId: page._id,
                    status: 'active',
                });
                isMember = !!membershipExists;
            }
        }

        const query: Record<string, unknown> = {
            pageId: page._id,
            status: 'published',
        };

        if (!isOwner && !isMember) {
            query.visibility = 'public';
        }

        const posts = await postRepository.findAndPopulate(
            query,
            'creatorId',
            'displayName username avatarUrl',
            { createdAt: -1 as any },
            50
        );
        
        return posts;
    }
};
