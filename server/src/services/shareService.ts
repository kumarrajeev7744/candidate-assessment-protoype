import { config } from '../config/env.js';
import {
  Candidate,
  Invitation,
  Question,
  Response,
  SHARE_LINK_EXPIRY_DAYS,
  ShareLink,
  type ShareLinkDocument,
} from '../models/index.js';
import { AppError } from '../utils/AppError.js';
import { addDays, isExpired } from '../utils/dates.js';
import { generateToken, hashToken, isWellFormedToken } from '../utils/token.js';
import { logger } from '../utils/logger.js';
import { EmailNotConfiguredError, isEmailConfigured, sendEmail } from './email/emailService.js';
import { buildShareEmail } from './email/templates/shareEmail.js';
import { assertObjectId } from './reportService.js';
import { toVideoPlayback, type VideoPlaybackDto } from './videoPlayback.js';

export function buildShareUrl(rawToken: string): string {
  return `${config.appBaseUrl}/shared-response/${rawToken}`;
}

export interface ShareLinkDto {
  id: string;
  recipientEmail: string;
  createdAt: string;
  expiresAt: string;
  emailStatus: string;
  emailSentAt: string | null;
}

function toShareLinkDto(link: ShareLinkDocument): ShareLinkDto {
  return {
    id: link.id as string,
    recipientEmail: link.recipientEmail,
    createdAt: link.createdAt.toISOString(),
    expiresAt: link.expiresAt.toISOString(),
    emailStatus: link.emailStatus,
    emailSentAt: link.emailSentAt ? link.emailSentAt.toISOString() : null,
  };
}

/**
 * Shares ONE response with a hiring manager by email.
 * - Only the SHA-256 hash of the token is stored; the raw token only goes into the email.
 * - A link becomes usable only once its email was sent.
 * - If an earlier share of the same response to the same recipient failed (and has not expired),
 *   that record is reused with a fresh token and its original expiry, so retries never create
 *   duplicate or confusing links.
 * Throws EMAIL_DELIVERY_FAILED (502) if the email could not be sent.
 */
export async function shareResponse(
  responseId: string,
  input: { candidateId: string; recipientEmail: string },
): Promise<{ shareLink: ShareLinkDto; reused: boolean }> {
  assertObjectId(responseId, 'response');
  const response = await Response.findById(responseId).lean();
  // Same 404 whether the response is missing or belongs to another candidate.
  if (!response || response.candidateId.toString() !== input.candidateId.toLowerCase()) {
    throw new AppError(404, 'Response not found for this candidate.', 'RESPONSE_NOT_FOUND');
  }
  const [candidate, invitation, question] = await Promise.all([
    Candidate.findById(response.candidateId).select('name').lean(),
    Invitation.findOne({ candidateId: response.candidateId }).select('status').lean(),
    Question.findById(response.questionId).select('questionNumber questionText').lean(),
  ]);
  if (!candidate || !question) throw new AppError(404, 'Response not found for this candidate.', 'RESPONSE_NOT_FOUND');
  if (invitation?.status !== 'Completed') {
    throw new AppError(409, 'Responses can be shared once the candidate has submitted the assessment.', 'ASSESSMENT_NOT_COMPLETED');
  }
  if (!response.writtenAnswer.trim() && response.video?.uploadStatus !== 'Uploaded') {
    throw new AppError(409, 'This question has no response to share.', 'NOTHING_TO_SHARE');
  }
  if (!isEmailConfigured()) throw new EmailNotConfiguredError();

  const rawToken = generateToken();
  const existingFailed = await ShareLink.findOne({
    responseId: response._id,
    recipientEmail: input.recipientEmail,
    emailStatus: { $in: ['Failed', 'Pending'] },
    expiresAt: { $gt: new Date() },
  }).sort({ createdAt: -1 });

  let link: ShareLinkDocument;
  if (existingFailed) {
    existingFailed.tokenHash = hashToken(rawToken); // the undelivered token is discarded; expiry unchanged
    existingFailed.emailStatus = 'Pending';
    link = await existingFailed.save();
  } else {
    link = await ShareLink.create({
      responseId: response._id,
      tokenHash: hashToken(rawToken),
      recipientEmail: input.recipientEmail,
      expiresAt: addDays(new Date(), SHARE_LINK_EXPIRY_DAYS),
      emailStatus: 'Pending',
    });
  }

  const attemptedAt = new Date();
  try {
    await sendEmail(
      buildShareEmail({
        to: input.recipientEmail,
        candidateName: candidate.name,
        questionNumber: question.questionNumber,
        questionText: question.questionText,
        shareUrl: buildShareUrl(rawToken),
        expiresAt: link.expiresAt,
        timeZone: config.emailTimeZone,
      }),
      'response-share',
    );
  } catch (err) {
    link.emailStatus = 'Failed';
    link.emailLastAttemptAt = attemptedAt;
    await link.save();
    logger.warn('Response share email failed', { shareLinkId: link.id });
    throw new AppError(
      502,
      'The share email could not be sent. No link was shared. Please try again.',
      'EMAIL_DELIVERY_FAILED',
      { shareLinkId: link.id, reason: err instanceof AppError ? err.code : 'EMAIL_ERROR' },
    );
  }

  link.emailStatus = 'Sent';
  link.emailSentAt = attemptedAt;
  link.emailLastAttemptAt = attemptedAt;
  await link.save();
  logger.info('Response shared', { shareLinkId: link.id, reused: Boolean(existingFailed) });
  return { shareLink: toShareLinkDto(link), reused: Boolean(existingFailed) };
}

export interface SharedResponseDto {
  candidateName: string;
  question: { number: number; text: string };
  response: { writtenAnswer: string; video: VideoPlaybackDto };
  expiresAt: string;
}

const invalidShareLink = () =>
  new AppError(404, 'This link is invalid. Please check that you copied the full link from the email.', 'SHARE_LINK_NOT_FOUND');

/** Public, read-only view of exactly the one shared response. */
export async function getSharedResponse(rawToken: string): Promise<SharedResponseDto> {
  if (!isWellFormedToken(rawToken)) throw invalidShareLink();
  const link = await ShareLink.findOne({ tokenHash: hashToken(rawToken) })
    .select('responseId expiresAt emailStatus')
    .lean();
  // Links whose email was never delivered are not usable.
  if (!link || link.emailStatus !== 'Sent') throw invalidShareLink();
  if (isExpired(link.expiresAt)) {
    throw new AppError(410, 'This link has expired. Please ask the recruiter to share the response again.', 'SHARE_LINK_EXPIRED');
  }
  const response = await Response.findById(link.responseId).select('candidateId questionId writtenAnswer video').lean();
  if (!response) throw invalidShareLink();
  const [candidate, question] = await Promise.all([
    Candidate.findById(response.candidateId).select('name').lean(),
    Question.findById(response.questionId).select('questionNumber questionText').lean(),
  ]);
  if (!candidate || !question) throw invalidShareLink();

  return {
    candidateName: candidate.name,
    question: { number: question.questionNumber, text: question.questionText },
    response: { writtenAnswer: response.writtenAnswer, video: await toVideoPlayback(response.video) },
    expiresAt: link.expiresAt.toISOString(),
  };
}
