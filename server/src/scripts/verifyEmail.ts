import { config } from '../config/env.js';
import { getFromAddress, isEmailConfigured, sendEmail, verifyEmailTransport } from '../services/email/emailService.js';
import { logger } from '../utils/logger.js';

/**
 * Checks SMTP settings: `npm run email:verify --workspace server [-- recipient@example.com]`.
 * With a recipient argument, also sends a short test email.
 */
async function main(): Promise<void> {
  if (!isEmailConfigured()) throw new Error('SMTP_USER and SMTP_PASS must be set in server/.env');
  logger.info('Checking SMTP connection', {
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    from: getFromAddress(),
  });
  await verifyEmailTransport();
  logger.info('SMTP connection and login OK');

  const to = process.argv[2];
  if (to) {
    await sendEmail(
      { to, subject: 'Candidate Assessment – SMTP test', text: 'SMTP is configured correctly.', html: '<p>SMTP is configured correctly.</p>' },
      'smtp-test',
    );
  }
}

main().catch((err: unknown) => {
  const e = err as { message?: string; code?: string; responseCode?: number };
  logger.error('SMTP check failed', { error: e.message, code: e.code, responseCode: e.responseCode });
  process.exitCode = 1;
});
