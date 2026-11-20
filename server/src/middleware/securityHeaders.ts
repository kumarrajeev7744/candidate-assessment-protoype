import type { NextFunction, Request, Response } from 'express';

/**
 * Conservative security headers for a JSON-only API (no HTML is ever served).
 * HSTS is added in production, where the API is only reachable over HTTPS.
 */
export function securityHeaders(options: { hsts: boolean }) {
  return (_req: Request, res: Response, next: NextFunction): void => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cache-Control', 'no-store');
    if (options.hsts) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  };
}
