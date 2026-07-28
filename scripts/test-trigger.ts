import mongoose from 'mongoose';
import * as commentService from '../src/services/commentService.js';
import { postService } from '../src/services/postService.js';
import '../src/models/User.js';
import '../src/models/CreatorPage.js';
import Notification from '../src/models/Notification.js';
import config from '../src/config/index.js';
import { initializeQueues, closeQueues } from '../src/jobs/queues.js';

// Run: npx ts-node --esm scripts/test-trigger.ts
// Be sure to replace these constants with the output from test-seed.ts
const CREATOR_ID: string = '6a68d1a453e7b354a2cfc624';
const MEMBER_IDS: string[] = ["6a68d1a653e7b354a2cfc62d","6a68d1a653e7b354a2cfc62e","6a68d1a653e7b354a2cfc62f"];
const POST_ID: string = '6a68d1a653e7b354a2cfc639';

async function main() {
    if (CREATOR_ID === 'PASTE_CREATOR_ID') {
        console.error('Please update the IDs in this file with the output from test-seed.ts');
        process.exit(1);
    }

    await mongoose.connect(config.mongodb.uri);
    console.log('Connected to Mongo');

    // Initialize BullMQ queues so addNotificationJob doesn't fail or fallback to sync
    initializeQueues();
    
    // We pass a mock io object to satisfy the service signatures. 
    // In actual tests, the socket script listens directly via socket.io client.
    const mockIo = { to: () => ({ emit: () => {} }) };

    console.log('\n--- TRIGGERING EVENTS ---');

    // 1. new_comment — fire once, check creator gets a notification
    console.log('1. Triggering new_comment...');
    await commentService.commentService.addPostComment(
        MEMBER_IDS[0], 
        'Test Member 1', 
        POST_ID, 
        'test comment 1', 
        null, 
        mockIo
    );

    // 2. post_liked x5 in quick succession — check it AGGREGATES to one doc
    console.log('2. Triggering post_liked (x5)...');
    await Promise.all(
        [...MEMBER_IDS, MEMBER_IDS[0], MEMBER_IDS[1]].map((id, index) =>
            postService.toggleLikePost(id, POST_ID, `Test Member ${index + 1}`, mockIo)
        )
    );

    // 3. new_post — publish to fire fan-out to all members
    console.log('3. Triggering new_post (fanout)...');
    await postService.updatePost(CREATOR_ID, POST_ID, { status: 'published' }, mockIo);

    // 4. Fire the SAME comment call twice — checks dedupeKey holds
    console.log('4. Triggering duplicate new_comment (checking idempotency)...');
    await commentService.commentService.addPostComment(
        MEMBER_IDS[0], 
        'Test Member 1', 
        POST_ID, 
        'test comment 2', 
        null, 
        mockIo
    );

    console.log('\nEvents triggered! Wait a few seconds for BullMQ to process them.');
    
    // Give BullMQ a moment to process the jobs
    await new Promise(resolve => setTimeout(resolve, 3000));

    // 5. Check results directly in Mongo
    const notifs = await Notification.find({ recipientId: CREATOR_ID }).sort({ createdAt: -1 });
    console.log(`\nFound ${notifs.length} notifications for creator:`);
    notifs.forEach((n) => console.log(`- [${n.type}] ${n.title} | body=${n.body} | dedupeKey=${n.dedupeKey} | count=${(n.metadata as any)?.count ?? 1}`));

    const memberNotifs = await Notification.find({ recipientId: MEMBER_IDS[0] }).sort({ createdAt: -1 });
    console.log(`\nFound ${memberNotifs.length} notifications for member 1:`);
    memberNotifs.forEach((n) => console.log(`- [${n.type}] ${n.title} | body=${n.body} | count=${(n.metadata as any)?.count ?? 1}`));

    await closeQueues();
    await mongoose.disconnect();
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
