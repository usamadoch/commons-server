import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { Types } from 'mongoose';

const mockCreatorPageRepository = {
    findOne: jest.fn<any>(),
    findById: jest.fn<any>(),
    updateOne: jest.fn<any>(),
};

const mockPostRepository = {
    create: jest.fn<any>(),
    findOne: jest.fn<any>(),
    findByIdAndUpdateNew: jest.fn<any>(),
    findOneAndDelete: jest.fn<any>(),
    countDocuments: jest.fn<any>(),
};

const mockMemberRepository = {
    find: jest.fn<any>().mockResolvedValue([]),
};

const mockCacheService = {
    get: jest.fn<any>(),
    set: jest.fn<any>(),
    del: jest.fn<any>().mockResolvedValue(undefined),
    invalidatePattern: jest.fn<any>().mockResolvedValue(undefined),
};

jest.unstable_mockModule('../../src/repositories/creatorPageRepository.js', () => ({
    creatorPageRepository: mockCreatorPageRepository,
}));

jest.unstable_mockModule('../../src/repositories/postRepository.js', () => ({
    postRepository: mockPostRepository,
}));

jest.unstable_mockModule('../../src/repositories/memberRepository.js', () => ({
    memberRepository: mockMemberRepository,
}));

jest.unstable_mockModule('../../src/config/redis.js', () => ({
    cacheService: mockCacheService,
    cacheKeys: {
        creatorPage: (slug: string) => `page:${slug}`,
        creatorFeedPattern: (slug: string) => `feed:${slug}:*`,
        creatorFeed: (slug: string) => `feed:${slug}`,
        creatorTiers: (id: string) => `tiers:${id}`,
    },
}));

jest.unstable_mockModule('../../src/jobs/queues.js', () => ({
    addNotificationJob: jest.fn<any>().mockResolvedValue(null),
    addMediaCleanupJob: jest.fn<any>().mockResolvedValue(null),
}));

jest.unstable_mockModule('../../src/models/MediaAsset.js', () => ({
    default: {
        updateMany: jest.fn<any>().mockResolvedValue({}),
    },
}));

jest.unstable_mockModule('../../src/repositories/postLikeRepository.js', () => ({
    postLikeRepository: { deleteMany: jest.fn<any>().mockResolvedValue({}) },
}));

jest.unstable_mockModule('../../src/repositories/postViewRepository.js', () => ({
    postViewRepository: { deleteMany: jest.fn<any>().mockResolvedValue({}) },
}));

jest.unstable_mockModule('../../src/repositories/postViewDedupRepository.js', () => ({
    postViewDedupRepository: { deleteMany: jest.fn<any>().mockResolvedValue({}) },
}));

jest.unstable_mockModule('../../src/repositories/commentRepository.js', () => ({
    commentRepository: { deleteMany: jest.fn<any>().mockResolvedValue({}) },
}));

const { postCrudService } = await import('../../src/services/postCrudService.js');

describe('Post Count Lifecycle and Invalidation Unit Tests', () => {
    const creatorUserId = new Types.ObjectId();
    const pageId = new Types.ObjectId();
    const postId = new Types.ObjectId().toString();

    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('postCrudService.createPost', () => {
        it('should increment postCount and invalidate caches when a published post is created', async () => {
            mockCreatorPageRepository.findOne.mockResolvedValueOnce({
                _id: pageId,
                pageSlug: 'commons',
                displayName: 'Commons Creator',
            });
            mockPostRepository.create.mockResolvedValueOnce({
                _id: postId,
                status: 'published',
                pageId,
                creatorId: creatorUserId,
            });

            await postCrudService.createPost(
                creatorUserId,
                { caption: 'Hello world', status: 'published', visibility: 'public' },
                []
            );

            // Verified: postCount incremented
            expect(mockCreatorPageRepository.updateOne).toHaveBeenCalledWith(
                { _id: pageId },
                { $inc: { postCount: 1 } }
            );
            // Verified: feed and page caches invalidated
            expect(mockCacheService.invalidatePattern).toHaveBeenCalledWith('feed:commons:*');
            expect(mockCacheService.del).toHaveBeenCalledWith('page:commons');
        });

        it('should NOT increment postCount or invalidate caches when a draft post is created', async () => {
            mockCreatorPageRepository.findOne.mockResolvedValueOnce({
                _id: pageId,
                pageSlug: 'commons',
                displayName: 'Commons Creator',
            });
            mockPostRepository.create.mockResolvedValueOnce({
                _id: postId,
                status: 'draft',
                pageId,
                creatorId: creatorUserId,
            });

            await postCrudService.createPost(
                creatorUserId,
                { caption: 'Draft post', status: 'draft', visibility: 'public' },
                []
            );

            expect(mockCreatorPageRepository.updateOne).not.toHaveBeenCalled();
            expect(mockCacheService.del).not.toHaveBeenCalled();
        });
    });

    describe('postCrudService.updatePost', () => {
        it('should increment postCount when post is updated from draft to published', async () => {
            mockPostRepository.findOne.mockResolvedValueOnce({
                _id: postId,
                creatorId: creatorUserId,
                status: 'draft', // was draft
            });
            mockPostRepository.findByIdAndUpdateNew.mockResolvedValueOnce({
                _id: postId,
                pageId,
                status: 'published', // now published
                caption: 'Now published',
            });
            mockCreatorPageRepository.findById.mockResolvedValueOnce({
                _id: pageId,
                displayName: 'Commons Creator',
                pageSlug: 'commons',
            });

            await postCrudService.updatePost(creatorUserId, postId, { status: 'published' }, null);

            expect(mockCreatorPageRepository.updateOne).toHaveBeenCalledWith(
                { _id: pageId },
                { $inc: { postCount: 1 } }
            );
            expect(mockCacheService.invalidatePattern).toHaveBeenCalledWith('feed:commons:*');
            expect(mockCacheService.del).toHaveBeenCalledWith('page:commons');
        });

        it('should decrement postCount when post is unpublished (published to draft)', async () => {
            mockPostRepository.findOne.mockResolvedValueOnce({
                _id: postId,
                creatorId: creatorUserId,
                status: 'published', // was published
            });
            mockPostRepository.findByIdAndUpdateNew.mockResolvedValueOnce({
                _id: postId,
                pageId,
                status: 'draft', // now draft
            });
            mockCreatorPageRepository.findById.mockResolvedValueOnce({
                _id: pageId,
                pageSlug: 'commons',
            });

            await postCrudService.updatePost(creatorUserId, postId, { status: 'draft' }, null);

            expect(mockCreatorPageRepository.updateOne).toHaveBeenCalledWith(
                { _id: pageId, postCount: { $gt: 0 } },
                { $inc: { postCount: -1 } }
            );
            expect(mockCacheService.invalidatePattern).toHaveBeenCalledWith('feed:commons:*');
            expect(mockCacheService.del).toHaveBeenCalledWith('page:commons');
        });
    });

    describe('postCrudService.deletePost', () => {
        it('should decrement postCount and invalidate caches when a published post is deleted', async () => {
            mockPostRepository.findOneAndDelete.mockResolvedValueOnce({
                _id: postId,
                pageId,
                creatorId: creatorUserId,
                status: 'published',
            });
            mockCreatorPageRepository.findById.mockResolvedValueOnce({
                _id: pageId,
                pageSlug: 'commons',
            });

            await postCrudService.deletePost(creatorUserId, postId);

            expect(mockCreatorPageRepository.updateOne).toHaveBeenCalledWith(
                { _id: pageId, postCount: { $gt: 0 } },
                { $inc: { postCount: -1 } }
            );
            expect(mockCacheService.invalidatePattern).toHaveBeenCalledWith('feed:commons:*');
            expect(mockCacheService.del).toHaveBeenCalledWith('page:commons');
        });

        it('should NOT decrement postCount when a draft post is deleted', async () => {
            mockPostRepository.findOneAndDelete.mockResolvedValueOnce({
                _id: postId,
                pageId,
                creatorId: creatorUserId,
                status: 'draft',
            });
            mockCreatorPageRepository.findById.mockResolvedValueOnce({
                _id: pageId,
                pageSlug: 'commons',
            });

            await postCrudService.deletePost(creatorUserId, postId);

            expect(mockCreatorPageRepository.updateOne).not.toHaveBeenCalled();
            expect(mockCacheService.invalidatePattern).toHaveBeenCalledWith('feed:commons:*');
            expect(mockCacheService.del).toHaveBeenCalledWith('page:commons');
        });
    });
});
