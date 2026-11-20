import { Router } from 'express';
import {
  candidateReportHandler,
  deleteCandidateHandler,
  sharedResponseHandler,
  shareReportHandler,
  shareResponseHandler,
} from '../controllers/reportController.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { validateBody } from '../middleware/validateBody.js';
import { createPublicRateLimiter } from '../middleware/rateLimiters.js';
import { shareReportSchema, shareResponseSchema } from '../validation/invitationSchemas.js';

/** Recruiter: candidate report, full-report sharing and deletion. */
export function createCandidateRouter(): Router {
  const router = Router();
  router.get('/:candidateId/report', requireAuth, candidateReportHandler);
  router.post('/:candidateId/share', requireAuth, validateBody(shareReportSchema), shareReportHandler);
  router.delete('/:candidateId', requireAuth, deleteCandidateHandler);
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
