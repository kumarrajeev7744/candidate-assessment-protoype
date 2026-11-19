import rateLimit from 'express-rate-limit';

export interface RateLimitOptions {
  windowMs: number;
  max: number;
}

/** Limits failed login attempts per client IP to slow down brute-force attacks. */
export function createLoginRateLimiter({ windowMs, max }: RateLimitOptions) {
  return rateLimit({
    windowMs,
    limit: max,
    skipSuccessfulRequests: true,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({
        error: {
          code: 'TOO_MANY_REQUESTS',
          message: 'Too many login attempts. Please try again later.',
        },
      });
    },
  });
}
