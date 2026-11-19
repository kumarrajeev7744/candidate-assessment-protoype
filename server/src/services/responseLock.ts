import mongoose, { type ClientSession } from 'mongoose';
import { Invitation } from '../models/index.js';
import { AppError } from '../utils/AppError.js';
import { isExpired } from '../utils/dates.js';
import type { CandidateSession } from '../types/assessment.js';

/** Explains why a write was refused, based on the invitation's current state. */
export async function lockedError(invitationId: CandidateSession['invitationId']): Promise<AppError> {
  const current = await Invitation.findById(invitationId).select('status expiresAt').lean();
  if (current?.status === 'Completed') {
    return new AppError(409, 'This assessment has already been submitted and can no longer be changed.', 'ASSESSMENT_COMPLETED');
  }
  if (current && isExpired(current.expiresAt)) {
    return new AppError(410, 'This invitation has expired. Please contact the recruiter to request a new link.', 'INVITATION_EXPIRED');
  }
  return new AppError(409, 'Please start the assessment before answering questions.', 'ASSESSMENT_NOT_STARTED');
}

/**
 * Runs a response write (written answer or video) in a transaction that first confirms the
 * invitation is still In Progress and bumps its responseVersion. Submission also updates the
 * invitation inside its own transaction, so the two can never interleave: a write either
 * commits before the assessment is completed or is rejected afterwards.
 */
export async function withResponseWriteLock<T>(
  candidate: CandidateSession,
  write: (dbSession: ClientSession) => Promise<T>,
): Promise<T> {
  const run = () =>
    mongoose.connection.transaction(async (dbSession) => {
      const lock = await Invitation.updateOne(
        { _id: candidate.invitationId, status: 'In Progress', expiresAt: { $gt: new Date() } },
        { $inc: { responseVersion: 1 } },
        { session: dbSession },
      );
      if (lock.matchedCount === 0) throw await lockedError(candidate.invitationId);
      return write(dbSession);
    });

  try {
    return await run();
  } catch (err) {
    // A first insert can race another on the candidate+question unique index; retrying turns it into an update.
    if ((err as { code?: number }).code === 11000) return run();
    throw err;
  }
}
