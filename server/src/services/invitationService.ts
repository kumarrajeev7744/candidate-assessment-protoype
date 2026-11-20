import { Types } from 'mongoose';
import { config } from '../config/env.js';
import {
  Candidate,
  Invitation,
  INVITATION_EXPIRY_DAYS,
  type CandidateDocument,
  type InvitationDocument,
  type InvitationStatus,
} from '../models/index.js';
import { AppError } from '../utils/AppError.js';
import { addDays, isExpired } from '../utils/dates.js';
import { generateToken, hashToken, isWellFormedToken } from '../utils/token.js';
import { logger } from '../utils/logger.js';
import { EmailNotConfiguredError, isEmailConfigured, sendEmail } from './email/emailService.js';
import { buildInvitationEmail } from './email/templates/invitationEmail.js';
import { deliverConfirmationEmail } from './confirmationEmailService.js';
import type { CreateInvitationInput } from '../validation/invitationSchemas.js';

export interface CandidateDto {
  id: string;
  name: string;
  email: string;
  createdAt: string;
}

export interface InvitationDto {
  id: string;
  candidateId: string;
  status: InvitationStatus;
  invitedAt: string;
  expiresAt: string;
  completedAt: string | null;
  emailStatus: string;
  confirmationEmailStatus: string | null;
  confirmationEmailSentAt: string | null;
  isExpired: boolean;
}

export interface EmailOutcome {
  sent: boolean;
  error?: string;
}

export interface InvitationResult {
  candidate: CandidateDto;
  invitation: InvitationDto;
  email: EmailOutcome;
}

export function buildInvitationUrl(rawToken: string): string {
  return `${config.appBaseUrl}/assessment/${rawToken}`;
}

function toCandidateDto(c: CandidateDocument): CandidateDto {
  return { id: c.id as string, name: c.name, email: c.email, createdAt: c.createdAt.toISOString() };
}

/** Public shape of an invitation. Never includes the token or its hash. */
function toInvitationDto(inv: InvitationDocument): InvitationDto {
  return {
    id: inv.id as string,
    candidateId: inv.candidateId.toString(),
    status: inv.status,
    invitedAt: inv.invitedAt.toISOString(),
    expiresAt: inv.expiresAt.toISOString(),
    completedAt: inv.completedAt ? inv.completedAt.toISOString() : null,
    emailStatus: inv.emailStatus,
    confirmationEmailStatus: inv.confirmationEmailStatus ?? null,
    confirmationEmailSentAt: inv.confirmationEmailSentAt ? inv.confirmationEmailSentAt.toISOString() : null,
    isExpired: inv.status !== 'Completed' && isExpired(inv.expiresAt),
  };
}

/**
 * Emails the invitation link and records the result on the invitation.
 * Never throws for email problems: failures are stored as emailStatus=Failed so the recruiter can resend.
 */
async function deliverInvitationEmail(
  candidate: CandidateDocument,
  invitation: InvitationDocument,
  rawToken: string,
): Promise<EmailOutcome> {
  let outcome: EmailOutcome;
  try {
    await sendEmail(
      buildInvitationEmail({
        to: candidate.email,
        candidateName: candidate.name,
        invitationUrl: buildInvitationUrl(rawToken),
        expiresAt: invitation.expiresAt,
        timeZone: config.emailTimeZone,
      }),
      'invitation',
    );
    invitation.emailStatus = 'Sent';
    outcome = { sent: true };
  } catch (err) {
    invitation.emailStatus = 'Failed';
    outcome = {
      sent: false,
      error: err instanceof AppError ? err.message : 'The email could not be delivered.',
    };
    if (!(err instanceof AppError)) {
      logger.error('Unexpected invitation email error', { invitationId: invitation.id, error: String(err) });
    }
  }
  await invitation.save();
  return outcome;
}

export async function createInvitation(input: CreateInvitationInput): Promise<InvitationResult> {
  const duplicate = () =>
    new AppError(409, 'A candidate with this email address already exists.', 'CANDIDATE_EXISTS');

  if (await Candidate.exists({ email: input.email })) throw duplicate();

  let candidate: CandidateDocument;
  try {
    candidate = await Candidate.create({ name: input.name, email: input.email });
  } catch (err) {
    if ((err as { code?: number }).code === 11000) throw duplicate(); // concurrent request won the race
    throw err;
  }

  const rawToken = generateToken();
  const invitedAt = new Date();
  let invitation: InvitationDocument;
  try {
    invitation = await Invitation.create({
      candidateId: candidate._id,
      tokenHash: hashToken(rawToken),
      status: 'Invited',
      invitedAt,
      expiresAt: addDays(invitedAt, INVITATION_EXPIRY_DAYS),
      emailStatus: 'Pending',
    });
  } catch (err) {
    // No multi-document transaction: undo the candidate so a retry is possible.
    await Candidate.deleteOne({ _id: candidate._id });
    throw err;
  }

  const email = await deliverInvitationEmail(candidate, invitation, rawToken);
  logger.info('Invitation created', { invitationId: invitation.id, emailStatus: invitation.emailStatus });
  return { candidate: toCandidateDto(candidate), invitation: toInvitationDto(invitation), email };
}

function assertInvitationId(invitationId: string): void {
  if (!/^[a-f0-9]{24}$/i.test(invitationId) || !Types.ObjectId.isValid(invitationId)) {
    throw new AppError(400, 'Invalid invitation ID.', 'INVALID_ID');
  }
}

export async function resendInvitation(invitationId: string): Promise<InvitationResult> {
  assertInvitationId(invitationId);
  const invitation = await Invitation.findById(invitationId);
  if (!invitation) throw new AppError(404, 'Invitation not found.', 'INVITATION_NOT_FOUND');
  if (invitation.status === 'Completed') {
    throw new AppError(409, 'This candidate has already completed the assessment.', 'ASSESSMENT_COMPLETED');
  }
  const candidate = await Candidate.findById(invitation.candidateId);
  if (!candidate) throw new AppError(404, 'Candidate not found for this invitation.', 'CANDIDATE_NOT_FOUND');
  if (candidate.rejection) {
    throw new AppError(409, 'This candidate has been rejected. Undo the rejection to resend the invitation.', 'CANDIDATE_REJECTED');
  }

  // Do not invalidate the existing link if a new one cannot be emailed at all.
  if (!isEmailConfigured()) throw new EmailNotConfiguredError();

  const rawToken = generateToken();
  invitation.tokenHash = hashToken(rawToken); // the previous link stops working immediately
  invitation.expiresAt = addDays(new Date(), INVITATION_EXPIRY_DAYS);
  invitation.emailStatus = 'Pending';
  await invitation.save();

  const email = await deliverInvitationEmail(candidate, invitation, rawToken);
  logger.info('Invitation resent', { invitationId: invitation.id, emailStatus: invitation.emailStatus });
  return { candidate: toCandidateDto(candidate), invitation: toInvitationDto(invitation), email };
}

export interface InvitationValidity {
  valid: true;
  status: InvitationStatus;
  expiresAt: string;
}

const invalidLink = () =>
  new AppError(404, 'This invitation link is invalid. Please check the link in your email.', 'INVITATION_NOT_FOUND');

/**
 * Read-only check of a candidate invitation link. Does NOT change the invitation status
 * (email security scanners may open links automatically).
 */
export async function validateInvitationToken(rawToken: string): Promise<InvitationValidity> {
  if (!isWellFormedToken(rawToken)) throw invalidLink();
  const invitation = await Invitation.findOne({ tokenHash: hashToken(rawToken) })
    .select('status expiresAt')
    .lean();
  if (!invitation) throw invalidLink();
  if (invitation.status === 'Completed') {
    throw new AppError(409, 'This assessment has already been submitted. Thank you!', 'ASSESSMENT_COMPLETED');
  }
  if (isExpired(invitation.expiresAt)) {
    throw new AppError(
      410,
      'This invitation has expired. Please contact the recruiter to request a new link.',
      'INVITATION_EXPIRED',
    );
  }
  return { valid: true, status: invitation.status, expiresAt: invitation.expiresAt.toISOString() };
}

/**
 * Retries the submission confirmation email for a completed assessment whose confirmation
 * was not delivered. Never changes the assessment status or completion time.
 */
export async function resendConfirmationEmail(invitationId: string): Promise<InvitationResult> {
  assertInvitationId(invitationId);
  const invitation = await Invitation.findById(invitationId);
  if (!invitation) throw new AppError(404, 'Invitation not found.', 'INVITATION_NOT_FOUND');
  if (invitation.status !== 'Completed') {
    throw new AppError(409, 'This assessment has not been submitted yet.', 'ASSESSMENT_NOT_COMPLETED');
  }
  if (invitation.confirmationEmailStatus === 'Sent') {
    throw new AppError(409, 'The confirmation email has already been sent.', 'CONFIRMATION_ALREADY_SENT');
  }
  if (!isEmailConfigured()) throw new EmailNotConfiguredError();
  const candidate = await Candidate.findById(invitation.candidateId);
  if (!candidate) throw new AppError(404, 'Candidate not found for this invitation.', 'CANDIDATE_NOT_FOUND');

  const email = await deliverConfirmationEmail(invitation._id);
  const updated = (await Invitation.findById(invitation._id))!;
  logger.info('Confirmation email resent', { invitationId, sent: email.sent });
  return { candidate: toCandidateDto(candidate), invitation: toInvitationDto(updated), email };
}
