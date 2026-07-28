import { memberRepository } from '../repositories/memberRepository.js';
import { creatorPageRepository } from '../repositories/creatorPageRepository.js';
import { createError } from '../middleware/errorHandler.js';
import { IMemberDocument } from '../models/Member.js';
import { Server } from 'socket.io';

interface JoinCreatorOptions {
    memberId: string;
    creatorId: string;
    pageId: string;
    memberDisplayName: string;
    io?: Server;
}

export class MemberService {
    /**
     * Join a creator (create or reactivate member)
     */
    static async joinCreator(options: JoinCreatorOptions): Promise<IMemberDocument> {
        throw createError.forbidden('Free joining is disabled. A paid subscription is required to join.');
    }

    /**
     * Leave a creator (cancel member)
     */
    static async leaveCreator(memberId: string, membershipId: string): Promise<void> {
        const member = await memberRepository.findOne({
            _id: membershipId,
            memberId,
        }) as IMemberDocument;

        if (!member) {
            throw createError.notFound('Member not found');
        }

        // Idempotency check: if already cancelled, do nothing
        if (member.status === 'cancelled') {
            return;
        }

        member.status = 'cancelled';
        member.cancelledAt = new Date();
        await member.save();

        // Update member count safely
        await creatorPageRepository.updateOne(
            { _id: member.pageId, memberCount: { $gt: 0 } },
            { $inc: { memberCount: -1 } }
        );
    }

    /**
     * Check member status
     */
    static async checkMembership(memberId: string, pageId: string) {
        const member = await memberRepository.findOne({
            memberId,
            pageId,
            status: 'active',
        });

        return {
            isMember: !!member,
            member: member || undefined,
        };
    }
}
