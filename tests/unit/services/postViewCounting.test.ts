import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { Types } from 'mongoose';

// Mock repositories before importing the service
const mockPostRepository = {
    findById: jest.fn<any>(),
    updateOne: jest.fn<any>(),
};

const mockPostViewRepository = {
    create: jest.fn<any>(),
    countDocuments: jest.fn<any>(),
};

const mockPostViewDedupRepository = {
    findOneAndUpdate: jest.fn<any>(),
    create: jest.fn<any>(),
    deleteMany: jest.fn<any>(),
};

jest.unstable_mockModule('../../../src/repositories/postRepository.js', () => ({
    postRepository: mockPostRepository,
}));

jest.unstable_mockModule('../../../src/repositories/postViewRepository.js', () => ({
    postViewRepository: mockPostViewRepository,
}));

jest.unstable_mockModule('../../../src/repositories/postViewDedupRepository.js', () => ({
    postViewDedupRepository: mockPostViewDedupRepository,
}));

// Dynamic imports after mocks
const { postCrudService } = await import('../../../src/services/postCrudService.js');
const { visitorIdMiddleware } = await import('../../../src/middleware/visitorId.js');

describe('Post View Counting System Unit Tests', () => {
    const validPostId = new Types.ObjectId().toString();
    const creatorId = new Types.ObjectId().toString();
    const otherUserId = new Types.ObjectId().toString();
    const visitorIdA = '11111111-1111-4111-a111-111111111111';
    const visitorIdB = '22222222-2222-4222-a222-222222222222';

    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('recordPostView - Core Rules & Deduplication', () => {
        it('1. should record a view for a first-time anonymous visitor', async () => {
            mockPostRepository.findById.mockResolvedValue({
                _id: new Types.ObjectId(validPostId),
                creatorId: new Types.ObjectId(creatorId),
                status: 'published',
                viewCount: 0,
            });

            // No expired cooldown record to update
            mockPostViewDedupRepository.findOneAndUpdate.mockResolvedValue(null);
            // Insert new dedup record succeeds
            mockPostViewDedupRepository.create.mockResolvedValue({
                postId: new Types.ObjectId(validPostId),
                viewerKey: `v:${visitorIdA}`,
            });
            mockPostRepository.updateOne.mockResolvedValue({ modifiedCount: 1 });
            mockPostViewRepository.create.mockResolvedValue({ _id: new Types.ObjectId() });

            const result = await postCrudService.recordPostView(validPostId, null, visitorIdA);

            expect(result).toEqual({ recorded: true, viewCount: 1 });
            expect(mockPostViewDedupRepository.create).toHaveBeenCalledTimes(1);
            expect(mockPostRepository.updateOne).toHaveBeenCalledWith(
                { _id: new Types.ObjectId(validPostId) },
                { $inc: { viewCount: 1 } }
            );
            expect(mockPostViewRepository.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    sessionId: `v:${visitorIdA}`,
                    userId: null,
                })
            );
        });

        it('2. should reject duplicate view within 12-hour cooldown window (E11000 duplicate key)', async () => {
            mockPostRepository.findById.mockResolvedValue({
                _id: new Types.ObjectId(validPostId),
                creatorId: new Types.ObjectId(creatorId),
                status: 'published',
                viewCount: 5,
            });

            // Active cooldown: findOneAndUpdate does not match (< 12 hours ago)
            mockPostViewDedupRepository.findOneAndUpdate.mockResolvedValue(null);
            // Duplicate key error on create
            const duplicateError: any = new Error('E11000 duplicate key error');
            duplicateError.code = 11000;
            mockPostViewDedupRepository.create.mockRejectedValue(duplicateError);

            const result = await postCrudService.recordPostView(validPostId, null, visitorIdA);

            expect(result).toEqual({ recorded: false, viewCount: 5 });
            expect(mockPostRepository.updateOne).not.toHaveBeenCalled();
            expect(mockPostViewRepository.create).not.toHaveBeenCalled();
        });

        it('3. should allow separate views for two anonymous visitors on the same IP (different visitorId)', async () => {
            mockPostRepository.findById.mockResolvedValue({
                _id: new Types.ObjectId(validPostId),
                creatorId: new Types.ObjectId(creatorId),
                status: 'published',
                viewCount: 1,
            });

            mockPostViewDedupRepository.findOneAndUpdate.mockResolvedValue(null);
            mockPostViewDedupRepository.create.mockResolvedValue({
                postId: new Types.ObjectId(validPostId),
                viewerKey: `v:${visitorIdB}`,
            });
            mockPostRepository.updateOne.mockResolvedValue({ modifiedCount: 1 });
            mockPostViewRepository.create.mockResolvedValue({ _id: new Types.ObjectId() });

            // Visitor B on same network
            const result = await postCrudService.recordPostView(validPostId, null, visitorIdB);

            expect(result).toEqual({ recorded: true, viewCount: 2 });
            expect(mockPostViewDedupRepository.create).toHaveBeenCalledWith(
                expect.objectContaining({ viewerKey: `v:${visitorIdB}` })
            );
        });

        it('4. should allow another view after 12 hours and log a new event in view history', async () => {
            mockPostRepository.findById.mockResolvedValue({
                _id: new Types.ObjectId(validPostId),
                creatorId: new Types.ObjectId(creatorId),
                status: 'published',
                viewCount: 10,
            });

            // Record older than 12 hours exists: findOneAndUpdate atomically matches and updates
            mockPostViewDedupRepository.findOneAndUpdate.mockResolvedValue({
                _id: new Types.ObjectId(),
                postId: new Types.ObjectId(validPostId),
                viewerKey: `v:${visitorIdA}`,
                viewedAt: new Date(),
            });
            mockPostRepository.updateOne.mockResolvedValue({ modifiedCount: 1 });
            mockPostViewRepository.create.mockResolvedValue({ _id: new Types.ObjectId() });

            const result = await postCrudService.recordPostView(validPostId, null, visitorIdA);

            expect(result).toEqual({ recorded: true, viewCount: 11 });
            // Does NOT create a new dedup row, refreshed existing one
            expect(mockPostViewDedupRepository.create).not.toHaveBeenCalled();
            // Preserves analytics by appending a new event to PostView history
            expect(mockPostViewRepository.create).toHaveBeenCalledTimes(1);
            expect(mockPostRepository.updateOne).toHaveBeenCalledWith(
                { _id: new Types.ObjectId(validPostId) },
                { $inc: { viewCount: 1 } }
            );
        });

        it('5. should deduplicate authenticated visitors by user ID', async () => {
            mockPostRepository.findById.mockResolvedValue({
                _id: new Types.ObjectId(validPostId),
                creatorId: new Types.ObjectId(creatorId),
                status: 'published',
                viewCount: 3,
            });

            mockPostViewDedupRepository.findOneAndUpdate.mockResolvedValue(null);
            const duplicateError: any = new Error('E11000 duplicate key');
            duplicateError.code = 11000;
            mockPostViewDedupRepository.create.mockRejectedValue(duplicateError);

            // User visits from a second device with a different visitorId
            const result = await postCrudService.recordPostView(validPostId, otherUserId, 'different-visitor-cookie');

            expect(result).toEqual({ recorded: false, viewCount: 3 });
            // Dedup query was based on u:otherUserId
            expect(mockPostViewDedupRepository.findOneAndUpdate).toHaveBeenCalledWith(
                expect.objectContaining({ viewerKey: `u:${otherUserId}` }),
                expect.anything(),
                expect.anything()
            );
        });
    });

    describe('recordPostView - Abuse & Guard Validation', () => {
        it('6. should reject creator self-views without modifying database', async () => {
            mockPostRepository.findById.mockResolvedValue({
                _id: new Types.ObjectId(validPostId),
                creatorId: new Types.ObjectId(creatorId),
                status: 'published',
                viewCount: 7,
            });

            const result = await postCrudService.recordPostView(validPostId, creatorId, visitorIdA);

            expect(result).toEqual({ recorded: false, viewCount: 7 });
            expect(mockPostViewDedupRepository.findOneAndUpdate).not.toHaveBeenCalled();
            expect(mockPostViewDedupRepository.create).not.toHaveBeenCalled();
            expect(mockPostRepository.updateOne).not.toHaveBeenCalled();
        });

        it('7. should reject views on unpublished (draft) posts with 404', async () => {
            mockPostRepository.findById.mockResolvedValue({
                _id: new Types.ObjectId(validPostId),
                creatorId: new Types.ObjectId(creatorId),
                status: 'draft',
                viewCount: 0,
            });

            await expect(
                postCrudService.recordPostView(validPostId, null, visitorIdA)
            ).rejects.toThrow('Post not found');

            expect(mockPostViewDedupRepository.create).not.toHaveBeenCalled();
            expect(mockPostRepository.updateOne).not.toHaveBeenCalled();
        });

        it('8. should reject invalid ObjectId string with 400', async () => {
            await expect(
                postCrudService.recordPostView('invalid-object-id', null, visitorIdA)
            ).rejects.toThrow('Invalid post ID');
        });
    });

    describe('visitorIdMiddleware - Security & Cookie Handling', () => {
        it('9. should generate and sign a new visitorId when cookie is missing', () => {
            const req: any = { signedCookies: {} };
            const cookiesSet: Record<string, any> = {};
            const res: any = {
                cookie: (name: string, val: string, opts: any) => {
                    cookiesSet[name] = { val, opts };
                }
            };
            const next = jest.fn();

            visitorIdMiddleware(req, res, next);

            expect(next).toHaveBeenCalledTimes(1);
            expect(req.visitorId).toBeDefined();
            expect(typeof req.visitorId).toBe('string');
            expect(cookiesSet.visitorId.opts.httpOnly).toBe(true);
            expect(cookiesSet.visitorId.opts.signed).toBe(true);
        });

        it('10. should preserve a valid existing signed visitorId', () => {
            const validUUID = '33333333-3333-4333-a333-333333333333';
            const req: any = { signedCookies: { visitorId: validUUID } };
            const cookiesSet: Record<string, any> = {};
            const res: any = {
                cookie: (name: string, val: string, opts: any) => {
                    cookiesSet[name] = { val, opts };
                }
            };
            const next = jest.fn();

            visitorIdMiddleware(req, res, next);

            expect(next).toHaveBeenCalledTimes(1);
            expect(req.visitorId).toBe(validUUID);
            expect(cookiesSet.visitorId).toBeUndefined();
        });

        it('11. should regenerate a fresh signed cookie if visitorId is forged/tampered', () => {
            const forgedValue = 'tampered-unsigned-string';
            const req: any = { signedCookies: { visitorId: forgedValue } };
            const cookiesSet: Record<string, any> = {};
            const res: any = {
                cookie: (name: string, val: string, opts: any) => {
                    cookiesSet[name] = { val, opts };
                }
            };
            const next = jest.fn();

            visitorIdMiddleware(req, res, next);

            expect(next).toHaveBeenCalledTimes(1);
            expect(req.visitorId).not.toBe(forgedValue);
            expect(cookiesSet.visitorId).toBeDefined();
            expect(cookiesSet.visitorId.opts.signed).toBe(true);
        });
    });
});
