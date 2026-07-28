import { Queue } from 'bullmq';
import { ioRedis } from '../src/config/redis.js';

async function checkFailed() {
    const queue = new Queue('notifications', { connection: ioRedis as any });
    const failedJobs = await queue.getFailed();
    console.log('Failed jobs:', failedJobs.length);
    for (const job of failedJobs) {
        console.log(`Job ${job.id} (${job.name}) failed with:`, job.failedReason);
        console.log(job.stacktrace);
    }
    process.exit(0);
}
checkFailed();
