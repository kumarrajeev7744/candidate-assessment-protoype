import type { NextFunction, Request, Response } from 'express';
import { logger } from '../utils/logger.js';

/** Invitation and share tokens appear in some URL paths; they must never reach the logs. */
const TOKEN_SEGMENT = /\/[A-Za-z0-9_-]{43}(?=\/|$)/g;

/** Path without query string and with raw tokens replaced. */
export function redactPath(url: string): string {
  return url.split('?')[0]!.replace(TOKEN_SEGMENT, '/:token');
}

/** One JSON line per request (method, redacted path, status, duration) for CloudWatch. Health checks are skipped. */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  if (req.path === '/api/health') {
    next();
    return;
  }
  const started = process.hrtime.bigint();
  res.on('finish', () => {
    const durationMs = Number((process.hrtime.bigint() - started) / 1_000_000n);
    const meta = { method: req.method, path: redactPath(req.originalUrl), status: res.statusCode, durationMs };
    if (res.statusCode >= 500) logger.warn('Request failed', meta);
    else logger.info('Request', meta);
  });
  next();
}
