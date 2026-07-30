import cron from 'node-cron';
import Subscription from '../models/Subscription.js';
import User from '../models/User.js';
import Tier from '../models/Tier.js';
import Member from '../models/Member.js';
import Transaction from '../models/Transaction.js';
import PaidLiveMessage from '../models/PaidLiveMessage.js';
import CreatorPage from '../models/CreatorPage.js';
import LiveSession from '../models/LiveSession.js';
import { logger } from '../config/logger.js';
import { getSafepayTrackerStatus } from '../services/safepayService.js';
import { SubscriptionService } from '../services/subscriptionService.js';
import { NotificationService } from '../services/notificationService.js';


export const runReconciliationTask = async () => {
    logger.info('[Reconciliation] Starting cron job');
    try {
        // ─── Subscription Reconciliation ──────────────────────────────────
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
            
        const staleSubscriptions = await Subscription.find({
            status: 'incomplete',
            createdAt: { $lt: oneHourAgo }
        });

        if (staleSubscriptions.length === 0) {
             logger.info('[Reconciliation] No stale subscriptions found');
        } else {
             logger.info(`[Reconciliation] Found ${staleSubscriptions.length} stale subscriptions.`);

             for (const sub of staleSubscriptions) {
                  if (!sub.safepaySubscriptionId) {
                      logger.info(`[Reconciliation] Marking ${sub._id} as canceled because it lacks tracker`);
                      sub.status = 'canceled';
                      await sub.save();
                      continue;
                  }

                  try {
                      const trackerData = await getSafepayTrackerStatus(sub.safepaySubscriptionId);
                      const state = trackerData?.data?.state;
                      
                      logger.info(`[Reconciliation] Tracker ${sub.safepaySubscriptionId} state: ${state}`);

                      // Depending on Safepay's response, we recover or cancel
                      if (state === 'TRACKER_ENDED' || state === 'TRACKER_PAID' || state === 'TRACKER_CAPTURED') {
                           logger.error(`[CRITICAL_RECONCILIATION_ERROR] Recovering paid subscription. SubID: ${sub._id}`);
                           
                           const plan = await Tier.findById(sub.planId);
                           const user = await User.findById(sub.userId);
                           
                           if (!plan || !user) {
                               logger.error(`[Reconciliation] Orphaned subscription lacks user or plan: ${sub._id}`);
                               sub.status = 'canceled';
                               await sub.save();
                               continue;
                           }

                           const nextBillingDate = new Date();
                           if (sub.interval === 'YEARLY') {
                               nextBillingDate.setDate(nextBillingDate.getDate() + 365);
                           } else {
                               nextBillingDate.setDate(nextBillingDate.getDate() + 30);
                           }
                           const priceToCharge = sub.interval === 'YEARLY' ? plan.price * 12 : plan.price;
                           const gross = priceToCharge;
                           const platformFee = Math.round(gross * 0.10);
                           const net = gross - platformFee;
                           const fourteenDaysFromNow = new Date();
                           fourteenDaysFromNow.setDate(fourteenDaysFromNow.getDate() + 14);

                           sub.status = 'active';
                           sub.currentPeriodStart = new Date();
                           sub.currentPeriodEnd = nextBillingDate;

                           await Promise.all([
                               sub.save(),
                               Member.findOneAndUpdate(
                                   { memberId: user._id, creatorId: plan.creatorId },
                                   {
                                       $set: { status: 'active', tier: plan.name },
                                       $setOnInsert: { pageId: plan.pageId }
                                   },
                                   { upsert: true, new: true }
                               ),
                               Transaction.create({
                                   userId: user._id,
                                   creatorId: plan.creatorId,
                                   pageId: plan.pageId,
                                   type: 'subscription',
                                   gross,
                                   platformFee,
                                   net,
                                   status: 'completed',
                                   releaseAt: fourteenDaysFromNow,
                                   description: `Subscription to ${plan.name} (Recovered by CRON)`,
                               }),
                               Tier.findByIdAndUpdate(plan._id, { $inc: { activeSubscribers: 1 } })
                           ]);
                           
                           logger.info(`[Reconciliation] Successfully recovered and activated subscription ${sub._id}`);

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
                                   metadata: { userId: user._id.toString(), action: 'add' }
                               }
                           ).catch(err => logger.error('[Reconciliation] Failed to send new member notification:', err));

                      } else if (state === 'TRACKER_CANCELLED' || state === 'TRACKER_EXPIRED') {
                           sub.status = 'canceled';
                           await sub.save();
                           logger.info(`[Reconciliation] Cancelled stale subscription ${sub._id} based on state: ${state}`);
                      } else {
                           // Tracker might be Started, but it's very old. Cancel after 2 hours.
                           const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
                           if ((sub as any).createdAt < twoHoursAgo) {
                               sub.status = 'canceled';
                               await sub.save();
                               logger.info(`[Reconciliation] Cancelled overly stale subscription ${sub._id} (age > 2hrs)`);
                           }
                      }
                  } catch (err) {
                       logger.error(`[Reconciliation] Error processing stale sub ${sub._id}:`, err);
                  }
             }
        }

        // ─── Super Chat Reconciliation ────────────────────────────────────
        await reconcileStaleSuperChats();

    } catch (err) {
        logger.error('[Reconciliation] Cron failure:', err);
    }
};

/**
 * Reconcile PaidLiveMessages stuck in 'pending' status.
 * These are payments where the webhook may have failed to deliver or
 * the fire-and-forget processing threw an error after the 200 was sent.
 */
async function reconcileStaleSuperChats() {
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);

    const stalePaidMessages = await PaidLiveMessage.find({
        paymentStatus: 'pending',
        paymentId: { $exists: true, $ne: null },
        createdAt: { $lt: thirtyMinutesAgo }
    });

    if (stalePaidMessages.length === 0) {
        logger.info('[Reconciliation] No stale Super Chat payments found');
        return;
    }

    logger.info(`[Reconciliation] Found ${stalePaidMessages.length} stale Super Chat payments`);

    for (const paidMsg of stalePaidMessages) {
        try {
            const trackerData = await getSafepayTrackerStatus(paidMsg.paymentId!);
            const state = trackerData?.data?.state;

            logger.info(`[Reconciliation] Super Chat ${paidMsg._id} tracker ${paidMsg.paymentId} state: ${state}`);

            if (state === 'TRACKER_ENDED' || state === 'TRACKER_PAID' || state === 'TRACKER_CAPTURED') {
                // Payment succeeded but webhook didn't process — recover it
                logger.error(`[CRITICAL_RECONCILIATION_ERROR] Recovering paid Super Chat. MsgID: ${paidMsg._id}`);

                paidMsg.paymentStatus = 'paid';
                await paidMsg.save();

                const creatorPage = await CreatorPage.findOne({ userId: paidMsg.creatorId });
                if (!creatorPage) {
                    logger.error(`[Reconciliation] No CreatorPage for Super Chat ${paidMsg._id}`);
                    continue;
                }

                const { gross, platformFee, net } = SubscriptionService.calculateFees(paidMsg.amountPKR);
                const releaseAt = new Date();
                releaseAt.setDate(releaseAt.getDate() + 14);

                await Promise.all([
                    Transaction.create({
                        userId: paidMsg.senderId,
                        creatorId: paidMsg.creatorId,
                        pageId: creatorPage._id,
                        type: 'superchat',
                        gross,
                        platformFee,
                        net,
                        status: 'completed',
                        releaseAt,
                        description: `Super Chat (Recovered by CRON) - Tier ${paidMsg.tierLabel}`,
                    }),
                    LiveSession.findByIdAndUpdate(paidMsg.sessionId, {
                        $inc: { totalCollected: net, totalPaidMessages: 1 }
                    })
                ]);

                logger.info(`[Reconciliation] Successfully recovered Super Chat ${paidMsg._id}`);

            } else if (state === 'TRACKER_CANCELLED' || state === 'TRACKER_EXPIRED') {
                paidMsg.paymentStatus = 'failed';
                await paidMsg.save();
                logger.info(`[Reconciliation] Marked stale Super Chat ${paidMsg._id} as failed (${state})`);

            } else {
                // Still in progress or unknown state — only fail if very old (> 2 hours)
                const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
                if ((paidMsg as any).createdAt < twoHoursAgo) {
                    paidMsg.paymentStatus = 'failed';
                    await paidMsg.save();
                    logger.info(`[Reconciliation] Expired Super Chat ${paidMsg._id} (age > 2hrs, state: ${state})`);
                }
            }
        } catch (err) {
            logger.error(`[Reconciliation] Error processing stale Super Chat ${paidMsg._id}:`, err);
        }
    }
}

export const startReconciliationCron = () => {
    // Run every hour at the top of the hour (e.g. 1:00, 2:00)
    cron.schedule('0 * * * *', () => {
        runReconciliationTask();
    });
};
