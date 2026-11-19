import { Router } from 'express';
import {
  createInvitationHandler,
  resendConfirmationHandler,
  resendInvitationHandler,
  validateInvitationHandler,
} from '../controllers/invitationController.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { validateBody } from '../middleware/validateBody.js';
import { createPublicRateLimiter } from '../middleware/rateLimiters.js';
import { createInvitationSchema } from '../validation/invitationSchemas.js';

export function createInvitationRouter(): Router {
  const router = Router();

  // Public: candidates open their link without an account.
  router.get('/validate/:token', createPublicRateLimiter(), validateInvitationHandler);

  // Recruiter only.
  router.post('/', requireAuth, validateBody(createInvitationSchema), createInvitationHandler);
  router.post('/:id/resend', requireAuth, resendInvitationHandler);
  router.post('/:id/resend-confirmation', requireAuth, resendConfirmationHandler);

  return router;
}
