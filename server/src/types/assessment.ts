import type { Types } from 'mongoose';
import type { InvitationStatus } from '../models/constants.js';

/** Identity attached to candidate requests by requireCandidate (derived only from the invitation token). */
export interface CandidateSession {
  invitationId: Types.ObjectId;
  candidateId: Types.ObjectId;
  status: InvitationStatus;
  expiresAt: Date;
}
