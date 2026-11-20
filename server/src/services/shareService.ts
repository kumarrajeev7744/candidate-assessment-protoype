import type { Types } from 'mongoose';
import { config } from '../config/env.js';
import {
  Candidate,
  Invitation,
  Question,
  Response,
  SHARE_LINK_EXPIRY_DAYS,
  ShareLink,
  type ShareLinkDocument,
  type ShareScope,
} from '../models/index.js';
import { AppError } from '../utils/AppError.js';
import { addDays, isExpired } from '../utils/dates.js';
import { generateToken, hashToken, isWellFormedToken } from '../utils/token.js';
import { logger } from '../utils/logger.js';
import { EmailNotConfiguredError, isEmailConfigured, sendEmail } from './email/emailService.js';
import { buildShareEmail } from './email/templates/shareEmail.js';
import { buildReportShareEmail } from './email/templates/reportShareEmail.js';
import type { EmailMessage } from './email/emailService.js';
import { loadActiveQuestions } from './assessmentService.js';
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
 * Creates (or, after a failed email, reuses) a share link and emails it.
 * - Only the SHA-256 hash of the token is stored; the raw token only goes into the email.
 * - A link becomes usable only once its email was sent.
 * - An earlier failed/pending share of the same content to the same recipient (not expired) is
 *   reused with a fresh token and its original expiry, so retries never create duplicate links.
 * Throws EMAIL_DELIVERY_FAILED (502) if the email could not be sent.
 */
async function createAndSendShareLink(options: {
  scope: ShareScope;
  candidateId: Types.ObjectId;
  responseId?: Types.ObjectId;
  recipientEmail: string;
  buildEmail: (shareUrl: string, expiresAt: Date) => EmailMessage;
  purpose: string;
}): Promise<{ shareLink: ShareLinkDto; reused: boolean }> {
  if (!isEmailConfigured()) throw new EmailNotConfiguredError();

  const rawToken = generateToken();
  const sameContent =
    options.scope === 'report'
      ? { scope: 'report' as const, candidateId: options.candidateId }
      : { scope: { $ne: 'report' as const }, responseId: options.responseId };
  const existingFailed = await ShareLink.findOne({
    ...sameContent,
    recipientEmail: options.recipientEmail,
    emailStatus: { $in: ['Failed', 'Pending'] },
    expiresAt: { $gt: new Date() },
  }).sort({ createdAt: -1 });

  let link: ShareLinkDocument;
  if (existingFailed) {
    existingFailed.tokenHash = hashToken(rawToken); // the undelivered token is discarded; expiry unchanged
    existingFailed.emailStatus = 'Pending';
    existingFailed.candidateId ??= options.candidateId;
    link = await existingFailed.save();
  } else {
    link = await ShareLink.create({
      scope: options.scope,
      candidateId: options.candidateId,
      ...(options.responseId ? { responseId: options.responseId } : {}),
      tokenHash: hashToken(rawToken),
      recipientEmail: options.recipientEmail,
      expiresAt: addDays(new Date(), SHARE_LINK_EXPIRY_DAYS),
      emailStatus: 'Pending',
    });
  }

  const attemptedAt = new Date();
  try {
    await sendEmail(options.buildEmail(buildShareUrl(rawToken), link.expiresAt), options.purpose);
  } catch (err) {
    link.emailStatus = 'Failed';
    link.emailLastAttemptAt = attemptedAt;
    await link.save();
    logger.warn('Share email failed', { shareLinkId: link.id, scope: options.scope });
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
  logger.info('Shared with hiring manager', { shareLinkId: link.id, scope: options.scope, reused: Boolean(existingFailed) });
  return { shareLink: toShareLinkDto(link), reused: Boolean(existingFailed) };
}

/** Shares ONE response with a hiring manager by email. */
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

  return createAndSendShareLink({
    scope: 'response',
    candidateId: response.candidateId,
    responseId: response._id,
    recipientEmail: input.recipientEmail,
    purpose: 'response-share',
    buildEmail: (shareUrl, expiresAt) =>
      buildShareEmail({
        to: input.recipientEmail,
        candidateName: candidate.name,
        questionNumber: question.questionNumber,
        questionText: question.questionText,
        shareUrl,
        expiresAt,
        timeZone: config.emailTimeZone,
      }),
  });
}

/** Shares a candidate's FULL assessment (all questions) with a hiring manager by email. */
export async function shareCandidateReport(
  candidateId: string,
  recipientEmail: string,
): Promise<{ shareLink: ShareLinkDto; reused: boolean }> {
  assertObjectId(candidateId, 'candidate');
  const candidate = await Candidate.findById(candidateId).select('name').lean();
  if (!candidate) throw new AppError(404, 'Candidate not found.', 'CANDIDATE_NOT_FOUND');
  const invitation = await Invitation.findOne({ candidateId: candidate._id }).select('status').lean();
  if (invitation?.status !== 'Completed') {
    throw new AppError(409, 'The assessment can be shared once the candidate has submitted it.', 'ASSESSMENT_NOT_COMPLETED');
  }
  const questions = await loadActiveQuestions();

  return createAndSendShareLink({
    scope: 'report',
    candidateId: candidate._id,
    recipientEmail,
    purpose: 'report-share',
    buildEmail: (shareUrl, expiresAt) =>
      buildReportShareEmail({
        to: recipientEmail,
        candidateName: candidate.name,
        questionCount: questions.length,
        shareUrl,
        expiresAt,
        timeZone: config.emailTimeZone,
      }),
  });
}

export interface SharedResponseDto {
  type: 'response';
  candidateName: string;
  question: { number: number; text: string };
  response: { writtenAnswer: string; video: VideoPlaybackDto };
  expiresAt: string;
}

export interface SharedReportDto {
  type: 'report';
  candidateName: string;
  questions: Array<{ number: number; text: string; writtenAnswer: string; video: VideoPlaybackDto }>;
  expiresAt: string;
}

const invalidShareLink = () =>
  new AppError(404, 'This link is invalid. Please check that you copied the full link from the email.', 'SHARE_LINK_NOT_FOUND');

/**
 * Public, read-only view of what a share link covers: exactly one response, or (for a full-report
 * share) the candidate's answers to the active questions. Never exposes emails, IDs, tokens or keys.
 */
export async function getSharedContent(rawToken: string): Promise<SharedResponseDto | SharedReportDto> {
  if (!isWellFormedToken(rawToken)) throw invalidShareLink();
  const link = await ShareLink.findOne({ tokenHash: hashToken(rawToken) })
    .select('scope responseId candidateId expiresAt emailStatus')
    .lean();
  // Links whose email was never delivered are not usable.
  if (!link || link.emailStatus !== 'Sent') throw invalidShareLink();
  if (isExpired(link.expiresAt)) {
    throw new AppError(410, 'This link has expired. Please ask the recruiter to share it again.', 'SHARE_LINK_EXPIRED');
  }

  if (link.scope === 'report') {
    if (!link.candidateId) throw invalidShareLink();
    const [candidate, questions, responses] = await Promise.all([
      Candidate.findById(link.candidateId).select('name').lean(),
      loadActiveQuestions(),
      Response.find({ candidateId: link.candidateId }).select('questionId writtenAnswer video').lean(),
    ]);
    if (!candidate) throw invalidShareLink();
    const byQuestion = new Map(responses.map((r) => [r.questionId.toString(), r]));
    return {
      type: 'report',
      candidateName: candidate.name,
      questions: await Promise.all(
        questions.map(async (q) => {
          const r = byQuestion.get(q._id.toString());
          return {
            number: q.questionNumber,
            text: q.questionText,
            writtenAnswer: r?.writtenAnswer ?? '',
            video: await toVideoPlayback(r?.video),
          };
        }),
      ),
      expiresAt: link.expiresAt.toISOString(),
    };
  }

  const response = await Response.findById(link.responseId).select('candidateId questionId writtenAnswer video').lean();
  if (!response) throw invalidShareLink();
  const [candidate, question] = await Promise.all([
    Candidate.findById(response.candidateId).select('name').lean(),
    Question.findById(response.questionId).select('questionNumber questionText').lean(),
  ]);
  if (!candidate || !question) throw invalidShareLink();

  return {
    type: 'response',
    candidateName: candidate.name,
    question: { number: question.questionNumber, text: question.questionText },
    response: { writtenAnswer: response.writtenAnswer, video: await toVideoPlayback(response.video) },
    expiresAt: link.expiresAt.toISOString(),
  };
}
