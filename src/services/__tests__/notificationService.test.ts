import { jest } from '@jest/globals';
import { IUserDocument } from '../../models/User';
import { INotificationDocument } from '../../models/Notification';

// Define mocks
jest.unstable_mockModule('../../models/User', () => ({
    __esModule: true,
    default: {
        findById: jest.fn(),
        find: jest.fn(),
    }
}));

jest.unstable_mockModule('../../models/Notification', () => ({
    __esModule: true,
    default: {
        create: jest.fn(),
        findOne: jest.fn(),
        insertMany: jest.fn(),
        findOneAndUpdate: jest.fn(),
    }
}));

jest.unstable_mockModule('../../config/logger', () => ({
    __esModule: true,
    logger: {
        warn: jest.fn(),
        error: jest.fn(),
        info: jest.fn(),
        debug: jest.fn(),
    }
}));

// Mock types
type MockQuery<T> = Promise<T> & {
    select: jest.Mock<() => Promise<T>>;
};

type MockUserModel = {
    findById: jest.Mock<(id: string) => MockQuery<IUserDocument | null>>;
    find: jest.Mock<() => MockQuery<IUserDocument[]>>;
};

type MockNotificationModel = {
    create: jest.Mock<(...args: any[]) => Promise<INotificationDocument>>;
    findOne: jest.Mock<(...args: any[]) => Promise<INotificationDocument | null>>;
    insertMany: jest.Mock<(...args: any[]) => Promise<INotificationDocument[]>>;
    findOneAndUpdate: jest.Mock<(...args: any[]) => Promise<INotificationDocument | null>>;
};

type MockLogger = {
    warn: jest.Mock;
    error: jest.Mock;
    info: jest.Mock;
    debug: jest.Mock;
};

// Dynamic imports variables
let NotificationService: any;
let User: MockUserModel;
let Notification: MockNotificationModel;
let logger: MockLogger;

describe('NotificationService', () => {
    const mockRecipientId = 'recipient123';
    const mockType = 'new_message';
    const mockTitle = 'New Message';
    const mockBody = 'You have a new message';
    const mockOptions = {
        actionUrl: '/messages/123',
        metadata: { conversationId: 'conv456' },
        io: { to: jest.fn().mockReturnThis(), emit: jest.fn() }
    };

    beforeAll(async () => {
        const notificationServiceModule = await import('../notificationService');
        NotificationService = notificationServiceModule.NotificationService;

        const userModule = await import('../../models/User');
        User = userModule.default as unknown as MockUserModel;

        const notificationModule = await import('../../models/Notification');
        Notification = notificationModule.default as unknown as MockNotificationModel;

        const loggerModule = await import('../../config/logger');
        logger = loggerModule.logger as unknown as MockLogger;
    });

    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('sendNotification', () => {
        it('should suppress notification if user preference is disabled', async () => {
            const mockUser = {
                notificationPreferences: {
                    inApp: { all: true },
                    push: { newMessages: false }
                }
            } as unknown as IUserDocument;

            User.findById.mockReturnValue({
                select: jest.fn<() => Promise<IUserDocument | null>>().mockResolvedValue(mockUser)
            } as unknown as MockQuery<IUserDocument | null>);

            const result = await NotificationService.sendNotification(
                mockRecipientId,
                mockType,
                mockTitle,
                mockBody,
                mockOptions
            );

            expect(result).toBeNull();
            expect(Notification.create).not.toHaveBeenCalled();
            expect(mockOptions.io.emit).not.toHaveBeenCalled();
        });

        it('should aggregate new messages if unread one exists', async () => {
            const mockUser = {
                notificationPreferences: {
                    inApp: { all: true },
                    push: { newMessages: true }
                }
            } as unknown as IUserDocument;

            User.findById.mockReturnValue({
                select: jest.fn<() => Promise<IUserDocument | null>>().mockResolvedValue(mockUser)
            } as unknown as MockQuery<IUserDocument | null>);

            const mockExistingNotification = {
                _id: 'notifABC',
                type: 'new_message',
                isRead: false,
                metadata: { conversationId: 'conv456', count: 2 },
                body: '1 new messages',
                save: jest.fn()
            } as unknown as INotificationDocument;

            Notification.findOneAndUpdate.mockResolvedValue(mockExistingNotification);

            await NotificationService.sendNotification(
                mockRecipientId,
                mockType,
                mockTitle,
                mockBody,
                mockOptions
            );

            expect(Notification.findOneAndUpdate).toHaveBeenCalledWith(
                { dedupeKey: `new_message:${mockRecipientId}:conv456` },
                expect.any(Object),
                { new: true, upsert: true }
            );
            expect(mockExistingNotification.body).toBe('2 new messages');
            expect(mockExistingNotification.save).toHaveBeenCalled();
            expect(mockOptions.io.to).toHaveBeenCalledWith(`user:${mockRecipientId}`);
            expect(mockOptions.io.emit).toHaveBeenCalledWith('notification', mockExistingNotification);
        });

        it('should create new aggregated notification via upsert if none exists', async () => {
            const mockUser = { notificationPreferences: undefined } as unknown as IUserDocument; // Should default to enabled

            User.findById.mockReturnValue({
                select: jest.fn<() => Promise<IUserDocument | null>>().mockResolvedValue(mockUser)
            } as unknown as MockQuery<IUserDocument | null>);

            const mockNewNotification = {
                _id: 'newNotifXYZ',
                type: 'new_message',
                title: mockTitle,
                body: '1 new messages',
                metadata: { conversationId: 'conv456', count: 1 },
                save: jest.fn()
            } as unknown as INotificationDocument;
            Notification.findOneAndUpdate.mockResolvedValue(mockNewNotification);

            await NotificationService.sendNotification(
                mockRecipientId,
                mockType,
                mockTitle,
                mockBody,
                mockOptions
            );

            expect(Notification.findOneAndUpdate).toHaveBeenCalledWith(
                { dedupeKey: `new_message:${mockRecipientId}:conv456` },
                expect.any(Object),
                { new: true, upsert: true }
            );
            expect(mockOptions.io.to).toHaveBeenCalledWith(`user:${mockRecipientId}`);
            expect(mockOptions.io.emit).toHaveBeenCalledWith('notification', mockNewNotification);
        });

        it('should create non-aggregated notification using Notification.create', async () => {
            const mockUser = { notificationPreferences: undefined } as unknown as IUserDocument;

            User.findById.mockReturnValue({
                select: jest.fn<() => Promise<IUserDocument | null>>().mockResolvedValue(mockUser)
            } as unknown as MockQuery<IUserDocument | null>);

            const nonAggNotification = { _id: 'liveNotif', ...mockOptions } as unknown as INotificationDocument;
            Notification.create.mockResolvedValue(nonAggNotification);

            await NotificationService.sendNotification(
                mockRecipientId,
                'creator_went_live',
                'Creator Live!',
                'Creator is now streaming',
                mockOptions
            );

            expect(Notification.create).toHaveBeenCalledWith(expect.objectContaining({
                recipientId: mockRecipientId,
                type: 'creator_went_live',
                title: 'Creator Live!',
            }));
            expect(mockOptions.io.to).toHaveBeenCalledWith(`user:${mockRecipientId}`);
            expect(mockOptions.io.emit).toHaveBeenCalledWith('notification', nonAggNotification);
        });

        it('should log warning if user not found', async () => {
            User.findById.mockReturnValue({
                select: jest.fn<() => Promise<IUserDocument | null>>().mockResolvedValue(null)
            } as unknown as MockQuery<IUserDocument | null>);

            await NotificationService.sendNotification(
                mockRecipientId,
                mockType,
                mockTitle,
                mockBody,
                mockOptions
            );

            expect(logger.warn).toHaveBeenCalled();
            expect(Notification.create).not.toHaveBeenCalled();
        });
    });

    describe('sendMassNotification', () => {
        it('should send notifications only to users with enabled preferences', async () => {
            const recipientIds = ['user1', 'user2'];
            const users = [
                { _id: 'user1', notificationPreferences: { push: { newPosts: true } } },
                { _id: 'user2', notificationPreferences: { push: { newPosts: false } } } // Should be skipped
            ] as unknown as IUserDocument[];

            User.find.mockReturnValue({
                select: jest.fn<() => Promise<IUserDocument[]>>().mockResolvedValue(users)
            } as unknown as MockQuery<IUserDocument[]>);

            Notification.insertMany.mockResolvedValue([{ recipientId: 'user1' }] as unknown as INotificationDocument[]);

            await NotificationService.sendMassNotification(
                recipientIds,
                'new_post',
                'New Post',
                'Check it out',
                { actionUrl: '/post/1' }
            );

            expect(Notification.insertMany).toHaveBeenCalledTimes(1);
            // Verify only 1 notification created
            expect(Notification.insertMany).toHaveBeenCalledWith(
                expect.arrayContaining([expect.objectContaining({ recipientId: 'user1' })])
            );
            expect(Notification.insertMany).not.toHaveBeenCalledWith(
                expect.arrayContaining([expect.objectContaining({ recipientId: 'user2' })])
            );
        });

        it('should return empty array if no recipients provided', async () => {
            const result = await NotificationService.sendMassNotification([], 'new_post', '', '', { actionUrl: '' });
            expect(result).toEqual([]);
            expect(User.find).not.toHaveBeenCalled();
        });
    });
});
