import { vi } from 'vitest';
import { setEmailTransportForTesting, type EmailMessage } from '../../src/services/email/emailService.js';

export type SentEmail = EmailMessage & { from: string };

/** Installs an in-memory SMTP transport. Call `fail()` to make the next sends throw like an SMTP error. */
export function installFakeEmail() {
  const sent: SentEmail[] = [];
  let failing = false;
  const sendMail = vi.fn(async (message: SentEmail) => {
    if (failing) {
      throw Object.assign(new Error('Invalid login: 535-5.7.8 Username and Password not accepted'), {
        code: 'EAUTH',
        responseCode: 535,
        command: 'AUTH PLAIN',
      });
    }
    sent.push(message);
    return { messageId: `<test-${sent.length}@example.com>` };
  });
  setEmailTransportForTesting({ sendMail });
  return {
    sent,
    sendMail,
    fail: (value = true) => {
      failing = value;
    },
    restore: () => setEmailTransportForTesting(null),
  };
}

/** Extracts the raw invitation token from the link in an invitation email. */
export function extractInvitationToken(email: SentEmail): string {
  const match = /\/assessment\/([A-Za-z0-9_-]{43})/.exec(email.text);
  if (!match?.[1]) throw new Error('No invitation link found in email');
  return match[1];
}
