import mongoose from 'mongoose';
import config from './src/config/index.js';
import { notificationRepository } from './src/repositories/notificationRepository.js';

async function test() {
    await mongoose.connect(config.mongodb.uri);
    console.log('Connected to Mongo');

    try {
        const dedupeKey = 'test_dedupe_key_' + Date.now();
        const insertData = {
            recipientId: new mongoose.Types.ObjectId().toString(),
            type: 'new_comment',
            title: 'New comment',
            body: 'Test user commented on your post',
            actionUrl: '/posts/123',
            actionLabel: 'View',
            imageUrl: null,
            metadata: { postId: '123', count: 1 },
            isRead: false,
        };

        const res = await notificationRepository.upsertByDedupeKey(
            dedupeKey,
            insertData,
            '1 new comments on your post'
        );
        console.log('Success!', res);
    } catch (err: any) {
        console.error('Mongo Error:', err.message);
    } finally {
        await mongoose.disconnect();
    }
}
test();
