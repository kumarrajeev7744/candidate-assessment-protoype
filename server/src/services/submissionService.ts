import mongoose from 'mongoose';
import { Invitation, Response, TOTAL_QUESTIONS } from '../models/index.js';
import { AppError } from '../utils/AppError.js';
import { isExpired } from '../utils/dates.js';
import { logger } from '../utils/logger.js';
import type { CandidateSession } from '../types/assessment.js';
import { loadActiveQuestions } from './assessmentService.js';
import { deliverConfirmationEmail } from './confirmationEmailService.js';

export interface MissingResponse {
  questionNumber: number;
  writtenMissing: boolean;
  videoMissing: boolean;
}

export interface SubmissionResult {
  assessment: { status: 'Completed'; completedAt: string };
  message: string;
  confirmationEmail: { sent: boolean };
}

/**
 * Validates every response on the server and completes the assessment.
 * Validation and the status change run in one transaction that also writes the invitation,
 * so concurrent submissions (or a late autosave) cannot interleave: exactly one completion wins.
 */
export async function submitAssessment(candidate: CandidateSession): Promise<SubmissionResult> {
  const completedAt = await mongoose.connection.transaction(async (dbSession) => {
    const invitation = await Invitation.findById(candidate.invitationId)
      .select('status expiresAt')
      .session(dbSession)
      .lean();
    if (!invitation) throw new AppError(401, 'This assessment link is invalid.', 'INVALID_ASSESSMENT_TOKEN');
    if (invitation.status === 'Completed') {
      throw new AppError(409, 'This assessment has already been submitted.', 'ASSESSMENT_COMPLETED');
    }
    if (isExpired(invitation.expiresAt)) {
      throw new AppError(410, 'This invitation has expired. Please contact the recruiter to request a new link.', 'INVITATION_EXPIRED');
    }
    if (invitation.status !== 'In Progress') {
      throw new AppError(409, 'Please start the assessment before submitting.', 'ASSESSMENT_NOT_STARTED');
    }

    const questions = await loadActiveQuestions(dbSession); // throws 503 unless exactly 10 active
    const responses = await Response.find({ candidateId: candidate.candidateId })
      .select('questionId writtenAnswer video.uploadStatus')
      .session(dbSession)
      .lean();
    const byQuestion = new Map(responses.map((r) => [r.questionId.toString(), r]));

    const missing: MissingResponse[] = [];
    for (const q of questions) {
      const r = byQuestion.get(q._id.toString());
      const writtenMissing = !r || r.writtenAnswer.trim().length === 0;
      const videoMissing = r?.video?.uploadStatus !== 'Uploaded';
      if (writtenMissing || videoMissing) missing.push({ questionNumber: q.questionNumber, writtenMissing, videoMissing });
    }
    if (questions.length !== TOTAL_QUESTIONS || missing.length > 0) {
      const numbers = missing.map((m) => m.questionNumber).join(', ');
      throw new AppError(
        400,
        `Your assessment is not complete yet. Please finish question${missing.length === 1 ? '' : 's'} ${numbers}.`,
        'ASSESSMENT_INCOMPLETE',
        { missing },
      );
    }

    const now = new Date();
    const result = await Invitation.updateOne(
      { _id: candidate.invitationId, status: 'In Progress' },
      {
        $set: { status: 'Completed', completedAt: now, confirmationEmailStatus: 'Pending' },
        $inc: { responseVersion: 1 },
      },
      { session: dbSession },
    );
    if (result.modifiedCount !== 1) {
      throw new AppError(409, 'This assessment has already been submitted.', 'ASSESSMENT_COMPLETED');
    }
    return now;
  });

  logger.info('Assessment submitted', { invitationId: candidate.invitationId.toString() });

  // The assessment is now permanently completed; an email failure is recorded but never undoes it.
  let emailSent = false;
  try {
    emailSent = (await deliverConfirmationEmail(candidate.invitationId)).sent;
  } catch (err) {
    logger.error('Confirmation email step failed', { error: err instanceof Error ? err.message : String(err) });
  }

  return {
    assessment: { status: 'Completed', completedAt: completedAt.toISOString() },
    message: 'Assessment submitted successfully.',
    confirmationEmail: { sent: emailSent },
  };
}
