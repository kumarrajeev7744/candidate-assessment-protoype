import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { AppError } from '../utils/AppError.js';
import { verifyAdminToken } from '../utils/jwt.js';

/**
 * Requires a valid admin JWT in the `Authorization: Bearer <token>` header.
 * Attaches the admin identity to `req.admin`. Reusable for all recruiter APIs.
 */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  const match = header ? /^Bearer\s+(\S+)$/i.exec(header) : null;
  if (!match?.[1]) {
    next(new AppError(401, 'Authentication required', 'UNAUTHORIZED'));
    return;
  }

  try {
    req.admin = verifyAdminToken(match[1]);
    next();
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      next(new AppError(401, 'Session expired. Please log in again.', 'TOKEN_EXPIRED'));
      return;
    }
    if (err instanceof jwt.JsonWebTokenError) {
      next(new AppError(401, 'Invalid authentication token', 'INVALID_TOKEN'));
      return;
    }
    next(err);
  }
}
