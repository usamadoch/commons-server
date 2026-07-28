/**
 * Email Worker — SCAFFOLD ONLY
 *
 * =============================================================================
 * ACTIVATION CHECKLIST — READ BEFORE FLIPPING EMAIL_ENABLED=true
 * =============================================================================
 *
 * 1. PROVIDER: Pick a transactional email provider.
 *    - Resend (developer-friendly, good free tier)
 *    - SendGrid (proven at scale, complex pricing)
 *    - AWS SES (cheapest at volume, requires more setup)
 *
 * 2. COST: Understand cost-per-send. At current volume, each `new_post` notification
 *    fans out to all members of a creator. If a creator has 10k members, that's
 *    10k emails per post. Budget accordingly.
 *
 * 3. VOLUME: Set up proper sender authentication (SPF/DKIM/DMARC) and warm up
 *    the sending domain before going live at volume.
 *
 * 4. IMPLEMENTATION: Swap the `sendEmail` stub in `emailService.ts` with real
 *    provider API calls. Build real HTML templates in `emailTemplates/`.
 *
 * 5. TESTING: Verify with a single-recipient test before enabling at scale.
 *
 * This file is INTENTIONALLY INERT until all the above is done.
 * =============================================================================
 */

import { Worker, Job } from 'bullmq';
import config from '../../config/index.js';
import { logger } from '../../config/logger.js';
import { ioRedis } from '../../config/redis.js';
import { QUEUE_NAMES, EmailJobData } from '../queues.js';
import { sendEmail } from '../../services/emailService.js';

let worker: Worker<EmailJobData> | null = null;

/**
 * Process email jobs by calling the (stub) sendEmail function.
 */
const processEmail = async (job: Job<EmailJobData>): Promise<void> => {
    const { to, template, data } = job.data;

    logger.debug('Processing email job', { jobId: job.id, to, template });

    try {
        await sendEmail(to, template, data);
        logger.info('Email job processed', { jobId: job.id, to, template });
    } catch (error) {
        logger.error('Failed to process email job', { jobId: job.id, error });
        throw error; // Re-throw to trigger retry
    }
};

/**
 * Start the email worker
 */
export const startEmailWorker = (): void => {
    if (!config.features.useBackgroundJobs) {
        logger.info('Background jobs disabled, email worker not started');
        return;
    }

    if (!ioRedis) {
        logger.warn('No Redis configured, email worker not started');
        return;
    }

    worker = new Worker<EmailJobData>(
        QUEUE_NAMES.EMAIL,
        processEmail,
        {
            connection: ioRedis as any,
            concurrency: 3,
        }
    );

    worker.on('completed', (job) => {
        logger.debug('Email job completed', { jobId: job.id });
    });

    worker.on('failed', (job, error) => {
        logger.error('Email job failed', { jobId: job?.id, error: error.message });
    });

    worker.on('error', (error) => {
        logger.error('Email worker error', { error: error.message });
    });

    logger.info('Email worker started');
};

/**
 * Stop the email worker
 */
export const stopEmailWorker = async (): Promise<void> => {
    if (worker) {
        await worker.close();
        worker = null;
        logger.info('Email worker stopped');
    }
};

export default { startEmailWorker, stopEmailWorker };
