import type { Types } from 'mongoose';
import { config } from '../config/env.js';
import { Candidate, Invitation } from '../models/index.js';
import { AppError } from '../utils/AppError.js';
import { logger } from '../utils/logger.js';
import { sendEmail } from './email/emailService.js';
import { buildConfirmationEmail } from './email/templates/confirmationEmail.js';

export interface ConfirmationEmailOutcome {
  sent: boolean;
  error?: string;
}

/**
 * Sends the submission confirmation email and records its own delivery status on the
 * invitation (separate from the invitation email). Never throws for email problems and
 * never changes the assessment status or completion time.
 */
export async function deliverConfirmationEmail(invitationId: Types.ObjectId | string): Promise<ConfirmationEmailOutcome> {
  const invitation = await Invitation.findById(invitationId).select('candidateId completedAt status').lean();
  if (!invitation || invitation.status !== 'Completed' || !invitation.completedAt) {
    throw new AppError(409, 'The assessment has not been completed.', 'ASSESSMENT_NOT_COMPLETED');
  }
  const candidate = await Candidate.findById(invitation.candidateId).select('name email').lean();
  if (!candidate) throw new AppError(404, 'Candidate not found for this invitation.', 'CANDIDATE_NOT_FOUND');

  const attemptedAt = new Date();
  let outcome: ConfirmationEmailOutcome;
  try {
    await sendEmail(
      buildConfirmationEmail({
        to: candidate.email,
        candidateName: candidate.name,
        completedAt: invitation.completedAt,
        timeZone: config.emailTimeZone,
        companyName: config.companyName,
      }),
      'submission-confirmation',
    );
    outcome = { sent: true };
  } catch (err) {
    outcome = {
      sent: false,
      error: err instanceof AppError ? err.message : 'The email could not be delivered.',
    };
    if (!(err instanceof AppError)) {
      logger.error('Unexpected confirmation email error', { invitationId: invitationId.toString(), error: String(err) });
    }
  }

  await Invitation.updateOne(
    { _id: invitationId },
    {
      $set: {
        confirmationEmailStatus: outcome.sent ? 'Sent' : 'Failed',
        confirmationEmailLastAttemptAt: attemptedAt,
        ...(outcome.sent ? { confirmationEmailSentAt: attemptedAt } : {}),
      },
    },
  );
  return outcome;
}
