import { subscriptionRepository } from '../repositories/subscriptionRepository.js';
import { NotificationService } from './notificationService.js';
import { userRepository } from '../repositories/userRepository.js';
import { tierRepository } from '../repositories/tierRepository.js';
import { transactionRepository } from '../repositories/transactionRepository.js';
import { SubscriptionService } from './subscriptionService.js';
import PaidLiveMessage, { IPaidLiveMessageDocument } from '../models/PaidLiveMessage.js';
import CreatorPage from '../models/CreatorPage.js';
import LiveSession from '../models/LiveSession.js';
import { appendToChatHistory } from '../controllers/live/shared.js';

export const webhookService = {
    async processPaymentSucceeded(tracker: any, io?: any) {
        const safepayTrackerId = tracker.tracker;

        console.log(`[Webhook] Tokenization/Auth complete for tracker: ${safepayTrackerId}`);

        // Idempotency guard: skip if subscription is already active for this tracker
        const activeSub = await subscriptionRepository.findOne({
            safepaySubscriptionId: safepayTrackerId,
            status: 'active'
        });

        if (activeSub) {
            console.log(`[Webhook] Ignored: Subscription already active for tracker ${safepayTrackerId} (Idempotency guard)`);
            return;
        }

        const pendingSub = await subscriptionRepository.findOne({
            safepaySubscriptionId: safepayTrackerId,
            status: 'incomplete'
        });

        if (!pendingSub) {
            // Check if it's a Super Chat payment instead
            const paidMsg = await PaidLiveMessage.findOne({ paymentId: safepayTrackerId });
            if (paidMsg) {
                if (paidMsg.paymentStatus === 'pending') {
                    console.log(`[Webhook] Found pending Super Chat for tracker ${safepayTrackerId}, updating to paid`);
                    await webhookService.activateSuperChat(paidMsg, safepayTrackerId, io);
                } else {
                    console.log(`[Webhook] Ignored: Super Chat already processed for tracker ${safepayTrackerId}`);
                }
            } else {
                console.log(`[Webhook] Ignored: No subscription or Super Chat found for tracker ${safepayTrackerId}`);
            }
            return;
        }

        // Find the user
        const user = await userRepository.findById(pendingSub.userId);
        if (!user) {
            console.error("[Webhook] No user found for incomplete subscription:", safepayTrackerId);
            return;
        }

        const cardToken = tracker?.action?.payment_method?.token;

        // Save card token to user for future unscheduled_cof charges
        if (cardToken) {
            await userRepository.updateById(user._id, { safepayPaymentMethodToken: cardToken });
        }

        const plan = await tierRepository.findById(pendingSub.planId);
        if (!plan) {
            console.error(`[Webhook] Tier not found for planId ${pendingSub.planId}`);
            return;
        }

        const priceToCharge = pendingSub.interval === 'YEARLY' ? plan.price * 12 : plan.price;

        try {
            await SubscriptionService.activateSubscription({
                subscriptionId: pendingSub._id,
                userId: user._id,
                creatorId: plan.creatorId,
                pageId: plan.pageId,
                planId: plan._id,
                tierName: plan.name,
                interval: (pendingSub.interval || 'MONTHLY') as 'MONTHLY' | 'YEARLY',
                price: priceToCharge
            });

            console.log(`[Webhook] Successfully activated subscription for user ${user.email} on tier ${plan.name}`);
            
            // Notify the creator
            await NotificationService.sendNotification(
                plan.creatorId.toString(),
                'new_member',
                'New Member!',
                `${user.displayName || 'Someone'} just subscribed to ${plan.name}`,
                {
                    actionUrl: '/members',
                    actionLabel: 'View Members',
                    imageUrl: user.avatarUrl || null,
                    metadata: { userId: user._id.toString(), action: 'add' },
                    io: io
                }
            ).catch(err => console.error('[Webhook] Failed to send new member notification:', err));

        } catch (dbErr) {
            const payload = {
                userId: user._id,
                planId: plan._id,
                tracker: safepayTrackerId,
                createdAt: new Date().toISOString()
            };
            console.error(`[CRITICAL_RECONCILIATION_ERROR] Charge succeeded but DB write failed. Data: ${JSON.stringify(payload)} Error:`, dbErr);
        }
    },

    /**
     * Handle payment.failed and subscription.payment.failed events.
     * Marks incomplete subscriptions as canceled and pending Super Chats as failed.
     */
    async processPaymentFailed(tracker: any) {
        const safepayTrackerId = tracker?.tracker;
        if (!safepayTrackerId) {
            console.warn('[Webhook] payment.failed event with no tracker ID');
            return;
        }

        console.log(`[Webhook] Payment failed for tracker: ${safepayTrackerId}`);

        // Check if it's a subscription payment
        const pendingSub = await subscriptionRepository.findOne({
            safepaySubscriptionId: safepayTrackerId,
            status: 'incomplete'
        });

        if (pendingSub) {
            await subscriptionRepository.updateById(pendingSub._id, { status: 'canceled' });
            console.log(`[Webhook] Marked incomplete subscription ${pendingSub._id} as canceled due to payment failure`);

            // Record the failed transaction for creator visibility
            const plan = await tierRepository.findById(pendingSub.planId);
            if (plan) {
                const priceToCharge = pendingSub.interval === 'YEARLY' ? plan.price * 12 : plan.price;
                await SubscriptionService.recordSubscriptionFailure({
                    userId: pendingSub.userId,
                    creatorId: plan.creatorId,
                    pageId: plan.pageId,
                    tierName: plan.name,
                    price: priceToCharge
                });
            }
            return;
        }

        // Check if it's a Super Chat payment
        const paidMsg = await PaidLiveMessage.findOne({ paymentId: safepayTrackerId, paymentStatus: 'pending' });
        if (paidMsg) {
            paidMsg.paymentStatus = 'failed';
            await paidMsg.save();
            console.log(`[Webhook] Marked pending Super Chat ${paidMsg._id} as failed`);
        }
    },

    /**
     * Handle subscription.canceled and subscription.ended events.
     * Marks active subscriptions as canceled and decrements subscriber count.
     */
    async processSubscriptionEnded(tracker: any) {
        const safepayTrackerId = tracker?.tracker || tracker?.subscription;
        if (!safepayTrackerId) {
            console.warn('[Webhook] subscription.canceled/ended event with no tracker ID');
            return;
        }

        console.log(`[Webhook] Subscription ended/canceled for: ${safepayTrackerId}`);

        const sub = await subscriptionRepository.findOne({
            safepaySubscriptionId: safepayTrackerId,
            status: 'active'
        });

        if (!sub) {
            console.log(`[Webhook] No active subscription found for ${safepayTrackerId}`);
            return;
        }

        await subscriptionRepository.updateById(sub._id, {
            status: 'canceled',
            canceledAt: new Date()
        });

        // Decrement the tier's active subscriber count
        await tierRepository.updateById(sub.planId, { $inc: { activeSubscribers: -1 } });
        console.log(`[Webhook] Canceled subscription ${sub._id} and decremented subscriber count`);
    },

    async activateSuperChat(paidMsg: IPaidLiveMessageDocument, trackerId: string, io?: any) {
        paidMsg.paymentStatus = 'paid';
        await paidMsg.save();

        try {
            const creatorPage = await CreatorPage.findOne({ userId: paidMsg.creatorId });
            if (!creatorPage) {
                console.error(`[Webhook] CreatorPage not found for creatorId ${paidMsg.creatorId}`);
                return;
            }

            const { gross, platformFee, net } = SubscriptionService.calculateFees(paidMsg.amountPKR);
            
            const releaseAt = new Date();
            releaseAt.setDate(releaseAt.getDate() + 14);

            await Promise.all([
                transactionRepository.create({
                    userId: paidMsg.senderId,
                    creatorId: paidMsg.creatorId,
                    pageId: creatorPage._id,
                    type: 'superchat',
                    gross,
                    platformFee,
                    net,
                    status: 'completed',
                    releaseAt,
                    description: `Super Chat from ${paidMsg.senderName || 'User'} - Tier ${paidMsg.tierLabel}`,
                }),
                LiveSession.findByIdAndUpdate(paidMsg.sessionId, {
                    $inc: { totalCollected: net, totalPaidMessages: 1 }
                })
            ]);

            console.log(`[Webhook] Successfully activated Super Chat ${paidMsg._id}`);

            if (io) {
                const user = await userRepository.findById(paidMsg.senderId);
                const payload = {
                    id: paidMsg._id.toString(),
                    source: 'commons',
                    type: 'paid',
                    senderName: user?.displayName || paidMsg.senderName,
                    senderAvatar: user?.avatarUrl || null,
                    message: paidMsg.message,
                    amountPKR: net,
                    tier: paidMsg.tier,
                    bgColor: paidMsg.bgColor,
                    headerColor: paidMsg.headerColor,
                    textColor: paidMsg.textColor,
                    isPinned: false,
                    isHearted: false,
                    timestamp: new Date(),
                };

                io.to(`live:${paidMsg.sessionId}`).emit('chat_message.new', { message: payload });
                appendToChatHistory(paidMsg.sessionId.toString(), [payload as any]);
            }
        } catch (err) {
            console.error(`[CRITICAL_RECONCILIATION_ERROR] Super Chat charge succeeded but DB write failed. Tracker: ${trackerId}`, err);
        }
    }
};
