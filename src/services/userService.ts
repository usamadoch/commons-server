import { userRepository } from '../repositories/userRepository.js';
import { creatorPageRepository } from '../repositories/creatorPageRepository.js';
import { createError } from '../middleware/errorHandler.js';
import { mediaLifecycleService } from './media/mediaLifecycleService.js';
import { UpdateUserInput } from '../utils/validators.js';

export const userService = {
    async getUserProfileById(id: string) {
        const user = await userRepository.findById(id, '-passwordHash -notificationPreferences');
        if (!user) {
            throw createError.notFound('User');
        }

        let page = null;
        if (user.role === 'creator') {
            page = await creatorPageRepository.findOne({ userId: user._id });
        }

        return { user, page };
    },

    async getUserProfileByUsername(username: string) {
        const user = await userRepository.findByUsername(username, '-passwordHash -notificationPreferences');
        if (!user) {
            throw createError.notFound('User');
        }

        let page = null;
        if (user.role === 'creator') {
            page = await creatorPageRepository.findOne({ userId: user._id });
        }

        return { user, page };
    },

    async updateCurrentUserProfile(userId: string, updateData: UpdateUserInput & { avatarUrl?: string }) {
        const oldUser = await userRepository.findById(userId);

        const updatedUser = await userRepository.updateById(userId, updateData as Record<string, unknown>, '-passwordHash');
        if (!updatedUser) {
            throw createError.notFound('User');
        }

        // Handle avatar lifecycle if it changed
        if (updateData.avatarUrl && oldUser && oldUser.avatarUrl !== updateData.avatarUrl) {
            await mediaLifecycleService.handleImageReplacement(
                oldUser.avatarUrl,
                updateData.avatarUrl,
                userId,
                'User',
                updatedUser._id
            );
        }

        return { user: updatedUser };
    }
};
