import type { NextFunction, Request, Response } from 'express';
import { Invitation } from '../models/index.js';
import { AppError } from '../utils/AppError.js';
import { isExpired } from '../utils/dates.js';
import { hashToken, isWellFormedToken } from '../utils/token.js';

export const ASSESSMENT_TOKEN_HEADER = 'x-assessment-token';

/**
 * Authenticates a candidate by the invitation token in the `X-Assessment-Token` header.
 * Rejects missing/invalid (401), completed (409) and expired (410) invitations, and attaches
 * `req.candidateSession`. Candidate identity always comes from the token, never from the request body.
 * Separate from the recruiter JWT middleware by design.
 */
export async function requireCandidate(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const token = req.get(ASSESSMENT_TOKEN_HEADER);
  if (!isWellFormedToken(token)) {
    throw new AppError(401, 'A valid assessment link is required.', 'INVALID_ASSESSMENT_TOKEN');
  }

  const invitation = await Invitation.findOne({ tokenHash: hashToken(token) })
    .select('candidateId status expiresAt')
    .lean();
  if (!invitation) {
    throw new AppError(
      401,
      'This assessment link is invalid. If you received a newer invitation email, please use that link.',
      'INVALID_ASSESSMENT_TOKEN',
    );
  }
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

  req.candidateSession = {
    invitationId: invitation._id,
    candidateId: invitation.candidateId,
    status: invitation.status,
    expiresAt: invitation.expiresAt,
  };
  next();
}
