import { Router } from 'express';
import { candidateReportHandler, sharedResponseHandler, shareResponseHandler } from '../controllers/reportController.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { validateBody } from '../middleware/validateBody.js';
import { createPublicRateLimiter } from '../middleware/rateLimiters.js';
import { shareResponseSchema } from '../validation/invitationSchemas.js';

/** Recruiter: GET /api/candidates/:candidateId/report */
export function createCandidateRouter(): Router {
  const router = Router();
  router.get('/:candidateId/report', requireAuth, candidateReportHandler);
  return router;
}

/** Recruiter: POST /api/responses/:responseId/share */
export function createResponseRouter(): Router {
  const router = Router();
  router.post('/:responseId/share', requireAuth, validateBody(shareResponseSchema), shareResponseHandler);
  return router;
}

/** Public (hiring manager): GET /api/shared-responses/:token */
export function createSharedResponseRouter(): Router {
  const router = Router();
  router.get('/:token', createPublicRateLimiter(), sharedResponseHandler);
  return router;
}
