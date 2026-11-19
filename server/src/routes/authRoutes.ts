import { Router } from 'express';
import { loginHandler, logoutHandler, meHandler } from '../controllers/authController.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { validateBody } from '../middleware/validateBody.js';
import { createLoginRateLimiter, type RateLimitOptions } from '../middleware/rateLimiters.js';
import { loginSchema } from '../validation/authSchemas.js';

export function createAuthRouter(loginRateLimit: RateLimitOptions): Router {
  const router = Router();
  router.post('/login', createLoginRateLimiter(loginRateLimit), validateBody(loginSchema), loginHandler);
  router.get('/me', requireAuth, meHandler);
  router.post('/logout', logoutHandler);
  return router;
}
