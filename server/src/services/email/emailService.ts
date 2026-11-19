import nodemailer from 'nodemailer';
import { config, type SmtpConfig } from '../../config/env.js';
import { AppError } from '../../utils/AppError.js';
import { logger } from '../../utils/logger.js';

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/** Minimal transport contract (satisfied by a Nodemailer transporter and by test fakes). */
export interface EmailTransport {
  sendMail(message: EmailMessage & { from: string }): Promise<{ messageId?: string }>;
  verify?(): Promise<unknown>;
}

export class EmailNotConfiguredError extends AppError {
  constructor() {
    super(503, 'Email service is not configured. Set SMTP_USER and SMTP_PASS on the server.', 'EMAIL_NOT_CONFIGURED');
  }
}

export class EmailDeliveryError extends AppError {
  constructor() {
    super(502, 'The email could not be delivered. Please try again later.', 'EMAIL_DELIVERY_FAILED');
  }
}

let transport: EmailTransport | null = null;
let overrideTransport: EmailTransport | null = null;

export function isEmailConfigured(smtp: SmtpConfig = config.smtp): boolean {
  return Boolean(smtp.user && smtp.pass);
}

export function getFromAddress(smtp: SmtpConfig = config.smtp): string {
  return smtp.from ?? `"Candidate Assessment" <${smtp.user ?? 'no-reply@localhost'}>`;
}

/** Lazily creates one reusable SMTP transporter. Throws EmailNotConfiguredError if credentials are missing. */
export function getTransport(): EmailTransport {
  if (overrideTransport) return overrideTransport;
  if (!isEmailConfigured()) throw new EmailNotConfiguredError();
  if (!transport) {
    const { host, port, secure, user, pass } = config.smtp;
    transport = nodemailer.createTransport({
      host,
      port,
      secure,
      requireTLS: !secure, // STARTTLS on 587
      auth: { user, pass },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    }) as unknown as EmailTransport;
  }
  return transport;
}

/** Test hook: replace the SMTP transport (pass null to restore the real one). */
export function setEmailTransportForTesting(fake: EmailTransport | null): void {
  overrideTransport = fake;
}

/** Extracts non-sensitive diagnostic fields from an SMTP error (never credentials or message bodies). */
function describeSmtpError(err: unknown): Record<string, unknown> {
  const e = err as { code?: unknown; responseCode?: unknown; command?: unknown };
  return {
    code: typeof e.code === 'string' ? e.code : undefined,
    responseCode: typeof e.responseCode === 'number' ? e.responseCode : undefined,
    command: typeof e.command === 'string' && !/^AUTH/i.test(e.command) ? e.command : undefined,
  };
}

/**
 * Sends an email. Throws EmailNotConfiguredError or EmailDeliveryError (both safe to show to clients).
 * Logs only the outcome and SMTP error codes; never credentials, links or message bodies.
 */
export async function sendEmail(message: EmailMessage, purpose: string): Promise<void> {
  const mailer = getTransport();
  try {
    await mailer.sendMail({ ...message, from: getFromAddress() });
    logger.info('Email sent', { purpose });
  } catch (err) {
    logger.error('Email delivery failed', { purpose, ...describeSmtpError(err) });
    throw new EmailDeliveryError();
  }
}

/** Checks SMTP connectivity and credentials (used by the email:verify script). */
export async function verifyEmailTransport(): Promise<void> {
  const mailer = getTransport();
  if (mailer.verify) await mailer.verify();
}
