import { Queue } from 'bullmq';
import { ioRedis } from '../src/config/redis.js';

async function checkFailed() {
    const queue = new Queue('notifications', { connection: ioRedis as any });
    const failedJobs = await queue.getFailed();
    console.log('Total failed jobs:', failedJobs.length);
    if (failedJobs.length > 0) {
        // Sort descending by finishedOn
        failedJobs.sort((a, b) => (b.finishedOn || 0) - (a.finishedOn || 0));
        const lastJob = failedJobs[0];
        console.log('Last failed job:', lastJob.id, lastJob.name, lastJob.failedReason, new Date(lastJob.finishedOn || 0).toISOString());
        console.log('Data:', JSON.stringify(lastJob.data, null, 2));
        console.log('Stacktrace:', lastJob.stacktrace);
    }
    process.exit(0);
}
checkFailed();
