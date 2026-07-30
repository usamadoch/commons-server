import { userRepository } from '../repositories/userRepository.js';
import { notificationRepository } from '../repositories/notificationRepository.js';
import { NotificationType, NotificationPreferences, NotificationMetadata } from '../types/index.js';
import { Server } from 'socket.io';
import { logger } from '../config/logger.js';

interface SendNotificationOptions {
    actionUrl: string;
    actionLabel?: string;
    imageUrl?: string | null;
    metadata?: NotificationMetadata;
    io?: Server;
}

/**
 * Aggregation configuration per notification type.
 * - groupKeyFn: extracts the grouping key from metadata (null = no aggregation)
 * - bodyBuilder: produces the notification body text given the current count
 */
interface AggregationConfig {
    groupKeyFn: (metadata: Record<string, unknown>) => string | null;
    bodyBuilder: (count: number, originalBody: string, userIds?: string[]) => Promise<string> | string;
}

const AGGREGATION_CONFIG: Partial<Record<NotificationType, AggregationConfig>> = {
    new_message: {
        groupKeyFn: (m) => (m.conversationId as string) || null,
        bodyBuilder: (count) => `${count} new messages`,
    },
    post_liked: {
        groupKeyFn: (m) => (m.postId as string)?.toString() || null,
        bodyBuilder: async (count, originalBody, userIds) => {
            if (count === 1) {
                if (originalBody) return originalBody;
                if (userIds && userIds.length === 1) {
                    const user = await userRepository.findById(userIds[0], 'displayName');
                    return `${user?.displayName || 'Someone'} liked your post`;
                }
                return 'Someone liked your post';
            }
            return `${count} people liked your post`;
        },
    },
    new_comment: {
        groupKeyFn: (m) => (m.postId as string)?.toString() || null,
        bodyBuilder: async (count, originalBody, userIds) => {
            if (count === 1) {
                if (originalBody) return originalBody;
                if (userIds && userIds.length === 1) {
                    const user = await userRepository.findById(userIds[0], 'displayName');
                    return `${user?.displayName || 'Someone'} commented on your post`;
                }
                return 'Someone commented on your post';
            }
            return `${count} people commented on your post`;
        },
    },
    comment_reply: {
        groupKeyFn: (m) => (m.parentId as string)?.toString() || null,
        bodyBuilder: async (count, originalBody, userIds) => {
            if (count === 1) {
                if (originalBody) return originalBody;
                if (userIds && userIds.length === 1) {
                    const user = await userRepository.findById(userIds[0], 'displayName');
                    return `${user?.displayName || 'Someone'} replied to your comment`;
                }
                return 'Someone replied to your comment';
            }
            return `${count} new replies to your comment`;
        },
    },
    new_member: {
        groupKeyFn: () => {
            // Rolling day-window bucket
            const now = new Date();
            return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
        },
        bodyBuilder: (count, originalBody) => count === 1 ? originalBody : `${count} new members joined today`,
    },
};

export class NotificationService {
    /**
     * Maps notification types to user preference keys
     */
    private static getPreferenceKey(type: NotificationType): string | null {
        switch (type) {
            case 'new_member': return 'newMembers';
            case 'new_post': return 'newPosts';
            case 'new_comment':
            case 'comment_reply': return 'newComments';
            case 'new_message': return 'newMessages';
            // 'post_liked', 'member_left', 'creator_went_live', 'system' don't have direct mappings
            // Return null to imply "always allow" (or subject to global switch)
            default: return null;
        }
    }

    /**
     * Checks if a user has enabled a specific notification type
     */
    private static isNotificationEnabled(prefs: NotificationPreferences | undefined, type: NotificationType): boolean {
        if (!prefs) return true; // Default to true if no prefs

        // Check global in-app switch
        if (prefs.inApp?.all === false) return false;

        const key = this.getPreferenceKey(type);
        if (!key) return true; // No specific setting, so allow it

        // Check push/in-app specific setting
        // We use 'push' object as the source of truth for in-app notification generation
        const pushPrefs = prefs.push as Record<string, boolean>;
        if (pushPrefs && typeof pushPrefs[key] === 'boolean') {
            return pushPrefs[key];
        }

        return true;
    }

    /**
     * Builds a dedupeKey for a notification. Returns null for non-aggregated types.
     * Format: `${type}:${recipientId}:${groupKey}`
     */
    private static buildDedupeKey(recipientId: string, type: NotificationType, metadata?: Record<string, unknown>): string | null {
        const config = AGGREGATION_CONFIG[type];
        if (!config) return null;

        const groupKey = config.groupKeyFn(metadata || {});
        if (!groupKey) return null;

        return `${type}:${recipientId}:${groupKey}`;
    }

    /**
     * Send a single notification — with aggregation and deduplication when applicable.
     */
    static async sendNotification(
        recipientId: string,
        type: NotificationType,
        title: string,
        body: string,
        options: SendNotificationOptions
    ) {
        try {
            const user = await userRepository.findById(recipientId, 'notificationPreferences');
            if (!user) {
                logger.warn(`Notification recipient not found: ${recipientId}`);
                return null;
            }

            if (!this.isNotificationEnabled(user.notificationPreferences, type)) {
                logger.debug(`Notification suppressed by user preferences`, { recipientId, type });
                return null;
            }

            const metadata = options.metadata || {};
            const dedupeKey = this.buildDedupeKey(recipientId, type, metadata as Record<string, unknown>);
            const aggConfig = AGGREGATION_CONFIG[type];

            // Aggregated path: upsert using dedupeKey
            if (dedupeKey && aggConfig) {
                const action = (metadata.action === 'remove') ? 'remove' : 'add';
                const actionUserId = metadata.userId as string | undefined;

                const insertData: Record<string, unknown> = {
                    recipientId,
                    type,
                    title,
                    body,
                    actionUrl: options.actionUrl,
                    actionLabel: options.actionLabel || 'View',
                    imageUrl: options.imageUrl || null,
                    metadata: { ...metadata },
                    isRead: false,
                };
                delete (insertData.metadata as any).action;

                if (actionUserId) {
                    const notification = await notificationRepository.aggregateUsersByDedupeKey(
                        dedupeKey,
                        actionUserId,
                        action,
                        insertData
                    );

                    if (notification) {
                        const userIds = (notification.metadata?.userIds as string[]) || [];
                        if (userIds.length === 0) {
                            await notification.deleteOne();
                            return null;
                        }
                        notification.body = await aggConfig.bodyBuilder(userIds.length, body, userIds);
                        await notification.save();

                        if (options.io) {
                            options.io.to(`user:${recipientId}`).emit('notification', notification);
                        }
                        return notification;
                    }
                    return null;
                } else {
                    // Fallback to legacy count-based increment
                    (insertData.metadata as any).count = 1;
                    const notification = await notificationRepository.upsertByDedupeKey(
                        dedupeKey,
                        insertData,
                        await aggConfig.bodyBuilder(1, body),
                    );

                    const currentCount = (notification.metadata as Record<string, unknown>)?.count as number || 1;
                    if (currentCount > 1) {
                        notification.body = await aggConfig.bodyBuilder(currentCount, body);
                        await notification.save();
                    }

                    if (options.io) {
                        options.io.to(`user:${recipientId}`).emit('notification', notification);
                    }
                    return notification;
                }
            }

            // Non-aggregated path: simple create with optional dedupeKey for idempotency
            const notification = await notificationRepository.create({
                recipientId,
                type,
                title,
                body,
                actionUrl: options.actionUrl,
                actionLabel: options.actionLabel || 'View',
                imageUrl: options.imageUrl || null,
                metadata: metadata,
                dedupeKey: null,
                isRead: false,
            });

            // Emit socket event if io is provided
            if (options.io) {
                options.io.to(`user:${recipientId}`).emit('notification', notification);
            }

            return notification;
        } catch (error) {
            logger.error('Error sending notification', { recipientId, type, error });
            throw error;
        }
    }

    /**
     * Send notification to multiple recipients (efficiently).
     * For non-aggregated types, uses bulk insert. For aggregated types, uses per-recipient upsert.
     */
    static async sendMassNotification(
        recipientIds: string[],
        type: NotificationType,
        title: string,
        body: string,
        options: SendNotificationOptions
    ) {
        if (recipientIds.length === 0) return [];

        try {
            // Fetch all users to check preferences
            const users = await userRepository.find({
                _id: { $in: recipientIds }
            }, '_id notificationPreferences');

            const eligibleRecipients = users.filter((user: any) =>
                this.isNotificationEnabled(user.notificationPreferences, type)
            );

            if (eligibleRecipients.length === 0) return [];

            const aggConfig = AGGREGATION_CONFIG[type];

            // For aggregated types, process each recipient individually (upsert)
            if (aggConfig) {
                const results = await Promise.all(
                    eligibleRecipients.map((user: any) =>
                        this.sendNotification(
                            user._id.toString(),
                            type,
                            title,
                            body,
                            options
                        )
                    )
                );
                return results.filter(Boolean);
            }

            // For non-aggregated types, bulk insert
            const notificationsData = eligibleRecipients.map((user: any) => ({
                recipientId: user._id,
                type,
                title,
                body,
                actionUrl: options.actionUrl,
                actionLabel: options.actionLabel || 'View',
                imageUrl: options.imageUrl || null,
                metadata: options.metadata || {},
                dedupeKey: null,
                isRead: false,
                createdAt: new Date(),
                updatedAt: new Date()
            }));

            // Bulk insert
            const notifications = await notificationRepository.insertMany(notificationsData);

            // Bulk emit
            if (options.io) {
                notifications.forEach((notification: any) => {
                    options.io!.to(`user:${notification.recipientId}`).emit('notification', notification);
                });
            }

            return notifications;
        } catch (error) {
            logger.error('Error sending mass notification', { type, count: recipientIds.length, error });
            throw error;
        }
    }
}
