import rateLimit from 'express-rate-limit';

export interface RateLimitOptions {
  windowMs: number;
  max: number;
}


function createLimiter({ windowMs, max }: RateLimitOptions, message: string, skipSuccessfulRequests = false) {
  return rateLimit({
    windowMs,
    limit: max,
    skipSuccessfulRequests,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({ error: { code: 'TOO_MANY_REQUESTS', message } });
    },
  });
}

/** Limits failed login attempts per client IP to slow down brute-force attacks. */
export function createLoginRateLimiter(options: RateLimitOptions) {
  return createLimiter(options, 'Too many login attempts. Please try again later.', true);
}

/** General per-IP limit for public (unauthenticated) token endpoints. */
export function createPublicRateLimiter(options: RateLimitOptions = { windowMs: 60_000, max: 60 }) {
  return createLimiter(options, 'Too many requests. Please wait a moment and try again.');
}
