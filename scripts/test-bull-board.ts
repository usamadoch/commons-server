import express from 'express';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { initializeQueues, getNotificationQueue, getAnalyticsQueue, getMediaCleanupQueue, getEmailQueue } from '../src/jobs/queues.js';

// Run: npx ts-node --esm scripts/test-bull-board.ts

async function main() {
    // Initialize standard queues
    initializeQueues();

    const notificationQueue = getNotificationQueue();
    const analyticsQueue = getAnalyticsQueue();
    const mediaCleanupQueue = getMediaCleanupQueue();
    const emailQueue = getEmailQueue();

    if (!notificationQueue || !analyticsQueue || !mediaCleanupQueue || !emailQueue) {
        console.error('Queues failed to initialize. Check Redis connection.');
        process.exit(1);
    }

    const serverAdapter = new ExpressAdapter();
    serverAdapter.setBasePath('/ui');

    createBullBoard({
        queues: [
            new BullMQAdapter(notificationQueue),
            new BullMQAdapter(analyticsQueue),
            new BullMQAdapter(mediaCleanupQueue),
            new BullMQAdapter(emailQueue),
        ],
        serverAdapter: serverAdapter,
    });

    const app = express();

    app.use('/ui', serverAdapter.getRouter());

    const PORT = 4000;
    app.listen(PORT, () => {
        console.log(`\n=============================================================`);
        console.log(`🐂 Bull Board is running!`);
        console.log(`👉 View queues at: http://localhost:${PORT}/ui`);
        console.log(`=============================================================\n`);
    });
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
