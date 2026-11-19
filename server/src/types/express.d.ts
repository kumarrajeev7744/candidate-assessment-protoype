import type { AuthenticatedAdmin } from './auth.js';
import type { CandidateSession } from './assessment.js';

declare global {
  namespace Express {
    interface Request {
      /** Set by the requireAuth middleware (recruiter JWT). */
      admin?: AuthenticatedAdmin;
      /** Set by the requireCandidate middleware (invitation token). */
      candidateSession?: CandidateSession;
    }
  }
}

export {};
