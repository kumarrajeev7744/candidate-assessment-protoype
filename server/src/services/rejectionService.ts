import { Candidate } from '../models/index.js';
import { AppError } from '../utils/AppError.js';
import { logger } from '../utils/logger.js';
import { assertObjectId } from './reportService.js';

export interface RejectionDto {
  reason: string;
  rejectedAt: string;
  rejectedBy: string;
}

export function toRejectionDto(r: { reason: string; rejectedAt: Date; rejectedBy: string } | null | undefined): RejectionDto | null {
  return r ? { reason: r.reason, rejectedAt: r.rejectedAt.toISOString(), rejectedBy: r.rejectedBy } : null;
}

/**
 * Records the recruiter's decision to reject a candidate. A candidate who has not submitted yet
 * can no longer use their assessment link. The candidate is not emailed.
 */
export async function rejectCandidate(
  candidateId: string,
  reason: string,
  recruiterEmail: string,
): Promise<{ candidateId: string; rejection: RejectionDto }> {
  assertObjectId(candidateId, 'candidate');
  // Conditional update: only one rejection is recorded even if two requests race.
  const updated = await Candidate.findOneAndUpdate(
    { _id: candidateId, rejection: { $exists: false } },
    { $set: { rejection: { reason, rejectedAt: new Date(), rejectedBy: recruiterEmail } } },
    { returnDocument: 'after', runValidators: true, lean: true },
  );
  if (!updated) {
    const exists = await Candidate.exists({ _id: candidateId });
    if (!exists) throw new AppError(404, 'Candidate not found.', 'CANDIDATE_NOT_FOUND');
    throw new AppError(409, 'This candidate has already been rejected.', 'ALREADY_REJECTED');
  }
  // The reason may be sensitive: log only identifiers.
  logger.info('Candidate rejected', { candidateId });
  return { candidateId, rejection: toRejectionDto(updated.rejection)! };
}

/** Reverses a rejection (e.g. a mistaken click). */
export async function undoRejection(candidateId: string): Promise<{ candidateId: string; rejection: null }> {
  assertObjectId(candidateId, 'candidate');
  const updated = await Candidate.findOneAndUpdate(
    { _id: candidateId, rejection: { $exists: true } },
    { $unset: { rejection: 1 } },
    { returnDocument: 'after', lean: true },
  );
  if (!updated) {
    const exists = await Candidate.exists({ _id: candidateId });
    if (!exists) throw new AppError(404, 'Candidate not found.', 'CANDIDATE_NOT_FOUND');
    throw new AppError(409, 'This candidate is not rejected.', 'NOT_REJECTED');
  }
  logger.info('Candidate rejection undone', { candidateId });
  return { candidateId, rejection: null };
}
