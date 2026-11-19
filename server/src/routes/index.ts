import { Router } from 'express';
import { healthRouter } from './healthRoutes.js';
import { createAuthRouter } from './authRoutes.js';
import { createInvitationRouter } from './invitationRoutes.js';
import { createAssessmentRouter } from './assessmentRoutes.js';
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
  return router;
}
