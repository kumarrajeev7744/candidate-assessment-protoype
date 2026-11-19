import { Router } from 'express';
import { healthRouter } from './healthRoutes.js';
import { createAuthRouter } from './authRoutes.js';
import { createInvitationRouter } from './invitationRoutes.js';
import { createAssessmentRouter } from './assessmentRoutes.js';
import { createCandidateRouter, createResponseRouter, createSharedResponseRouter } from './reportRoutes.js';
import type { RateLimitOptions } from '../middleware/rateLimiters.js';

export interface ApiRouterOptions {
  loginRateLimit: RateLimitOptions;
}

export function createApiRouter(options: ApiRouterOptions): Router {
  const router = Router();
  router.use('/health', healthRouter);
  router.use('/auth', createAuthRouter(options.loginRateLimit));
  router.use('/invitations', createInvitationRouter());
  router.use('/assessment', createAssessmentRouter());
  router.use('/candidates', createCandidateRouter());
  router.use('/responses', createResponseRouter());
  router.use('/shared-responses', createSharedResponseRouter());
  return router;
}
