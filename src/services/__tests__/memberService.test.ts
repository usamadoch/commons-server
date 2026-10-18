import { jest } from '@jest/globals';
import { createError } from '../../middleware/errorHandler';
// Import types for mocking
import { IMemberDocument } from '../../models/Member';
import { ICreatorPageDocument } from '../../models/CreatorPage';

// Define mocks using unstable_mockModule which works with ESM
// These must be defined BEFORE importing the modules under test

jest.unstable_mockModule('../../models/Member', () => ({
    __esModule: true,
    default: {
        findOne: jest.fn(),
        create: jest.fn(),
        findById: jest.fn(),
    }
}));

jest.unstable_mockModule('../../models/CreatorPage', () => ({
    __esModule: true,
    default: {
        findById: jest.fn(),
        updateOne: jest.fn(),
    }
}));

jest.unstable_mockModule('../notificationService', () => ({
    __esModule: true,
    NotificationService: {
        sendNotification: jest.fn()
    }
}));

// Mock types
type MockModel<T> = {
    findOne: jest.Mock<(...args: any[]) => Promise<T | null>>;
    create: jest.Mock<(...args: any[]) => Promise<T>>;
    findById: jest.Mock<(...args: any[]) => Promise<T | null>>;
    updateOne: jest.Mock<(...args: any[]) => Promise<any>>;
};

// Dynamic imports variables
// Use strict types for mocked modules
let MemberService: any; // We can't easily type the service class itself without importing it, but that's fine as we test its methods
let Member: MockModel<IMemberDocument>;
let CreatorPage: Pick<MockModel<ICreatorPageDocument>, 'findById' | 'updateOne'>;
let NotificationService: { sendNotification: jest.Mock };

describe('MemberService', () => {
    const mockMemberId = 'member123';
    const mockCreatorId = 'creator456';
    const mockPageId = 'page789';
    const mockMembershipId = 'membershipABC';
    const mockMemberDisplayName = 'Test User';
    const mockIo = { to: jest.fn().mockReturnThis(), emit: jest.fn() };

    beforeAll(async () => {
        const memberServiceModule = await import('../memberService');
        MemberService = memberServiceModule.MemberService;

        const membershipModule = await import('../../models/Member');
        Member = membershipModule.default as unknown as MockModel<IMemberDocument>;

        const creatorPageModule = await import('../../models/CreatorPage');
        CreatorPage = creatorPageModule.default as unknown as MockModel<ICreatorPageDocument>;

        const notificationServiceModule = await import('../notificationService');
        NotificationService = notificationServiceModule.NotificationService as unknown as { sendNotification: jest.Mock };
    });

    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('joinCreator', () => {
        it('should throw forbidden error as free joining is disabled in favor of paid subscriptions', async () => {
            await expect(MemberService.joinCreator({
                memberId: mockMemberId,
                creatorId: mockCreatorId,
                pageId: mockPageId,
                memberDisplayName: mockMemberDisplayName,
            })).rejects.toEqual(createError.forbidden('Free joining is disabled. A paid subscription is required to join.'));
        });
    });

    describe('leaveCreator', () => {
        it('should throw error if member not found', async () => {
            Member.findOne.mockResolvedValue(null);

            await expect(MemberService.leaveCreator(mockMemberId, mockMembershipId))
                .rejects.toEqual(createError.notFound('Member not found'));
        });

        it('should successfully cancel active member', async () => {
            const mockMembership = {
                _id: mockMembershipId,
                pageId: mockPageId,
                status: 'active',
                save: jest.fn()
            } as unknown as IMemberDocument;
            Member.findOne.mockResolvedValue(mockMembership);

            await MemberService.leaveCreator(mockMemberId, mockMembershipId);

            expect(mockMembership.status).toBe('cancelled');
            expect(mockMembership.save).toHaveBeenCalled();
            expect(CreatorPage.updateOne).toHaveBeenCalledWith(
                { _id: mockPageId, memberCount: { $gt: 0 } },
                { $inc: { memberCount: -1 } }
            );
        });

        it('should do nothing if already cancelled (Idempotency)', async () => {
            const mockMembership = {
                _id: mockMembershipId,
                pageId: mockPageId,
                status: 'cancelled',
                save: jest.fn()
            } as unknown as IMemberDocument;
            Member.findOne.mockResolvedValue(mockMembership);

            await MemberService.leaveCreator(mockMemberId, mockMembershipId);

            expect(mockMembership.save).not.toHaveBeenCalled();
            expect(CreatorPage.updateOne).not.toHaveBeenCalled();
        });
    });

    describe('checkMembership', () => {
        it('should return isMember true if active member exists', async () => {
            const mockMembership = { status: 'active' } as unknown as IMemberDocument;
            Member.findOne.mockResolvedValue(mockMembership);

            const result = await MemberService.checkMembership(mockMemberId, mockPageId);

            expect(result).toEqual({
                isMember: true,
                member: mockMembership
            });
        });

        it('should return isMember false if no active member', async () => {
            Member.findOne.mockResolvedValue(null);

            const result = await MemberService.checkMembership(mockMemberId, mockPageId);

            expect(result).toEqual({
                isMember: false,
                member: undefined
            });
        });
    });
});
