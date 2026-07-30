import { Types } from 'mongoose';
import { memberRepository } from '../repositories/memberRepository.js';
import { createError } from '../middleware/errorHandler.js';

export const checkPostAccess = async (post: any, userId?: string | Types.ObjectId | null) => {
    if (post.visibility === 'members' && post.status === 'published') {
        if (!userId) throw createError.unauthorized('Authentication required to interact with this post');

        const creatorIdStr = post.creatorId.toString();
        const userIdStr = userId.toString();

        if (creatorIdStr !== userIdStr) {
            const member = await memberRepository.findOne({
                memberId: userId,
                creatorId: post.creatorId,
                status: 'active',
            });
            if (!member) throw createError.forbidden('Members only content');
        }
    }
};
