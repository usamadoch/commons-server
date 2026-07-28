/**
 * Email Service — SCAFFOLD ONLY
 *
 * This module is intentionally inert. When EMAIL_ENABLED=false (the default),
 * sendEmail logs the call and returns immediately. No HTTP requests, no SDK
 * calls, no network activity of any kind.
 *
 * Before flipping EMAIL_ENABLED to true:
 *   1. Pick an email provider (Resend, SendGrid, AWS SES, etc.)
 *   2. Install the provider's SDK
 *   3. Understand cost-per-send and volume projections
 *   4. Implement the real send logic below
 *   5. Build real HTML templates in emailTemplates/
 */

import config from '../config/index.js';
import { logger } from '../config/logger.js';

export interface EmailPayload {
    to: string;
    template: string;
    data: Record<string, unknown>;
}

/**
 * Send an email. Currently a no-op stub that logs the intent.
 *
 * @param to - Recipient email address
 * @param template - Template name (e.g. 'new-post')
 * @param data - Template variables
 */
export const sendEmail = async (to: string, template: string, data: Record<string, unknown>): Promise<void> => {
    if (!config.features.emailEnabled) {
        logger.debug('[EmailService] EMAIL_ENABLED=false, skipping send', { to, template, data });
        return;
    }

    // TODO(email): implement once EMAIL_ENABLED — wire in a real provider SDK here
    logger.info('[EmailService] Would send email (provider not configured)', { to, template, data });
};
