import { Server as SocketIOServer } from 'socket.io';
import { liveSessionRepository } from '../repositories/liveSession.repository.js';
import { paidLiveMessageRepository } from '../repositories/paidLiveMessage.repository.js';
import { liveChatMessageRepository } from '../repositories/liveChatMessage.repository.js';
import { superChatTierRepository } from '../repositories/superChatTier.repository.js';
import ChatMute from '../models/ChatMute.js';
import { createTracker, getAuthToken, getSafepayTrackerStatus, getOrCreateSafepayCustomer, getSavedPaymentMethod, chargesavedCard, getWallet, deletePaymentMethod } from './safepayService.js';
import { appendToChatHistory, CommonsLiveMessage } from '../controllers/live/shared.js';
import { createError } from '../middleware/errorHandler.js';
import { SubscriptionService } from './subscriptionService.js';
import { creatorPageRepository } from '../repositories/creatorPageRepository.js';
import mongoose from 'mongoose';

// Rate limiting map: userId -> array of timestamps
const chatRateLimits = new Map<string, number[]>();

// Cache interfaces
interface CachedSession {
    _id: mongoose.Types.ObjectId | any;
    status: string;
    creatorId: mongoose.Types.ObjectId | any;
}

interface CachedCreatorPage {
    displayName: string;
    avatarUrl?: string | null;
}

const sessionCache = new Map<string, CachedSession>();
const creatorCache = new Map<string, CachedCreatorPage | null>();

export const liveMessageService = {
    clearSessionCaches(sessionId: string) {
        sessionCache.delete(sessionId);
        // Clean up creator cache entries for this session
        for (const key of creatorCache.keys()) {
            if (key.startsWith(sessionId)) {
                creatorCache.delete(key);
            }
        }
    },

    async initiatePaidMessage(sessionId: string, amount: number, message: string, user: any) {
        if (!amount || amount < 100) throw createError.invalidInput('Invalid amount');

        const session = await liveSessionRepository.findById(sessionId);
        if (!session || session.status !== 'live') throw createError.invalidInput('Session is not active');

        const mute = await ChatMute.findOne({ sessionId: session._id, userId: user._id });
        if (mute && mute.mutedUntil > new Date()) {
            throw createError.forbidden(`You are in timeout until ${mute.mutedUntil.toLocaleTimeString()}`);
        }

        const tiers = await superChatTierRepository.findActiveTiersSorted();
        const tierData = tiers.find(t => amount >= t.minAmount);
        if (!tierData) throw createError.invalidInput('Amount is below minimum requirement');

        const customerToken = await getOrCreateSafepayCustomer(user);
        const tracker = await createTracker(amount, null, customerToken, "PKR", { mode: "payment" });
        const authToken = await getAuthToken();

        const paidMsg = await paidLiveMessageRepository.create({
            sessionId: session._id,
            creatorId: session.creatorId,
            senderId: user._id,
            senderName: user.displayName,
            senderEmail: user.email,
            message: message || '',
            amountPKR: amount,
            tier: tierData.tierLevel,
            tierLabel: tierData.tierLabel,
            bgColor: tierData.bgColor,
            headerColor: tierData.bgColor,
            textColor: tierData.textColor,
            pinDurationMinutes: tierData.pinTimeMinutes,
            maxChars: tierData.maxLength,
            paymentId: tracker.token,
            paymentStatus: 'pending'
        });

        return { trackerToken: tracker.token, authToken, messageId: paidMsg._id };
    },

    async setupTracker(user: any) {
        const customerToken = await getOrCreateSafepayCustomer(user);
        // Using amount 1 for tokenization, some gateways require > 0
        const tracker = await createTracker(1, null, customerToken, "PKR", { mode: "instrument" });
        const authToken = await getAuthToken();

        return { trackerToken: tracker.token, authToken };
    },

    async chargeSavedMessage(io: SocketIOServer, sessionId: string, msgId: string, paymentMethodToken: string | undefined, user: any) {
        const paidMsg = await paidLiveMessageRepository.findPendingMessage(msgId, sessionId, user._id.toString());
        if (!paidMsg) throw createError.notFound('Pending message not found');

        const customerToken = await getOrCreateSafepayCustomer(user);

        let tokenToCharge = paymentMethodToken;
        if (!tokenToCharge) {
            const savedMethod = await getSavedPaymentMethod(customerToken);
            if (!savedMethod || !savedMethod.token) throw createError.invalidInput('No saved card found');
            tokenToCharge = savedMethod.token;
        }

        try {
            await chargesavedCard(customerToken, tokenToCharge, paidMsg.amountPKR, 'PKR');
        } catch (err: any) {
            console.error("[Safepay] Charge failed:", err);
            const error = createError.invalidInput(err.message || 'Payment failed with saved card.');
            Object.assign(error, { code: err.code || 'CHARGE_FAILED', fallbackToNewCard: true });
            throw error;
        }

        await paidLiveMessageRepository.updatePaymentStatus(msgId, 'paid', 'saved-card-' + paidMsg.paymentId);

        const payload: CommonsLiveMessage = {
            id: paidMsg._id.toString(),
            source: 'commons',
            type: 'paid',
            senderId: user._id.toString(),
            senderName: user.displayName,
            senderAvatar: user.avatarUrl || null,
            message: paidMsg.message,
            amountPKR: paidMsg.amountPKR,
            tier: paidMsg.tier,
            bgColor: paidMsg.bgColor,
            headerColor: paidMsg.headerColor,
            textColor: paidMsg.textColor,
            isPinned: false,
            isHearted: false,
            timestamp: new Date(),
        };

        io.to(`live:${sessionId}`).emit('chat_message.new', { message: payload });
        appendToChatHistory(sessionId, [payload]);
    },

    async confirmPaidMessage(io: SocketIOServer, sessionId: string, trackerToken: string, user: any) {
        const paidMsg = await paidLiveMessageRepository.findByPaymentId(sessionId, trackerToken);
        if (!paidMsg) throw createError.notFound('Message not found');

        if (paidMsg.paymentStatus === 'paid') {
            // Already marked as paid by the webhook. We still emit the socket event to ensure it shows up in chat.
        } else {
            const status = await getSafepayTrackerStatus(trackerToken);
            if (status?.data?.state !== 'TRACKER_ENDED') throw createError.invalidInput('Payment not completed');

            await paidLiveMessageRepository.updatePaymentStatus(paidMsg._id.toString(), 'paid');
        }

        try {
            const customerToken = user.safepayCustomerToken;
            // Removed automatic deletion of older payment methods to support multiple saved cards.
        } catch (e) {
            console.error("Error with payment methods cleanup:", e);
        }

        const payload: CommonsLiveMessage = {
            id: paidMsg._id.toString(),
            source: 'commons',
            type: 'paid',
            senderId: user._id.toString(),
            senderName: user.displayName,
            senderAvatar: user.avatarUrl || null,
            message: paidMsg.message,
            amountPKR: paidMsg.amountPKR,
            tier: paidMsg.tier,
            bgColor: paidMsg.bgColor,
            headerColor: paidMsg.headerColor,
            textColor: paidMsg.textColor,
            isPinned: false,
            isHearted: false,
            timestamp: new Date(),
        };

        io.to(`live:${sessionId}`).emit('chat_message.new', { message: payload });
        appendToChatHistory(sessionId, [payload]);
    },

    async sendChatMessage(io: SocketIOServer, sessionId: string, message: string, user: any) {
        const now = Date.now();
        const userIdStr = user._id.toString();

        let userWindow = chatRateLimits.get(userIdStr) || [];
        userWindow = userWindow.filter(t => now - t < 3000);

        if (userWindow.length >= 5) {
            throw createError.rateLimited('You are sending messages too fast. Please slow down.');
        }

        userWindow.push(now);
        chatRateLimits.set(userIdStr, userWindow);

        let session = sessionCache.get(sessionId);
        if (!session) {
            const dbSession = await liveSessionRepository.findById(sessionId);
            if (!dbSession) throw createError.notFound('Session not found');
            session = { _id: dbSession._id, status: dbSession.status, creatorId: dbSession.creatorId };
            sessionCache.set(sessionId, session);
        }

        if (session.status !== 'live') throw createError.invalidInput('Session is not live');

        const mute = await ChatMute.findOne({ sessionId: session._id, userId: user._id });
        if (mute && mute.mutedUntil > new Date()) {
            throw createError.forbidden(`You are in timeout until ${mute.mutedUntil.toLocaleTimeString()}`);
        }

        let finalSenderName = user.displayName;
        let finalSenderAvatar = user.avatarUrl || null;

        if (session.creatorId) {
            const cacheKey = `${sessionId}_${userIdStr}`;
            if (!creatorCache.has(cacheKey)) {
                const creatorPage = await creatorPageRepository.findOne({ _id: session.creatorId, userId: user._id }).lean();
                if (creatorPage) {
                    creatorCache.set(cacheKey, { displayName: creatorPage.displayName, avatarUrl: creatorPage.avatarUrl });
                } else {
                    creatorCache.set(cacheKey, null);
                }
            }

            const cachedCreator = creatorCache.get(cacheKey);
            if (cachedCreator) {
                finalSenderName = cachedCreator.displayName;
                finalSenderAvatar = cachedCreator.avatarUrl || null;
            }
        }

        const chatMsg = await liveChatMessageRepository.create({
            sessionId: session._id,
            senderId: user._id,
            senderName: finalSenderName,
            senderAvatar: finalSenderAvatar,
            message: message.trim(),
        });

        const payload: CommonsLiveMessage = {
            id: chatMsg._id.toString(),
            source: 'commons',
            type: 'free',
            senderId: user._id.toString(),
            senderName: finalSenderName,
            senderAvatar: finalSenderAvatar,
            message: chatMsg.message,
            amountPKR: 0,
            tier: 0,
            bgColor: '',
            headerColor: '',
            textColor: '',
            isPinned: false,
            isHearted: false,
            timestamp: new Date(),
        };

        io.to(`live:${sessionId}`).emit('chat_message.new', { message: payload });
        appendToChatHistory(sessionId, [payload]);

        return payload;
    }
};
