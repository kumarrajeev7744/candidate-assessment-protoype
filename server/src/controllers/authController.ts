import type { Request, Response } from 'express';
import * as authService from '../services/authService.js';
import type { LoginInput } from '../validation/authSchemas.js';
import { logger } from '../utils/logger.js';
import { AppError } from '../utils/AppError.js';

export async function loginHandler(req: Request, res: Response): Promise<void> {
  const { email, password } = req.body as LoginInput;
  try {
    const result = await authService.login(email, password);
    logger.info('Admin login succeeded', { adminId: result.admin.id });
    res.status(200).json(result);
  } catch (err) {
    if (err instanceof AppError && err.statusCode === 401) {
      logger.warn('Admin login failed', { ip: req.ip });
    }
    throw err;
  }
}

export async function meHandler(req: Request, res: Response): Promise<void> {
  const admin = await authService.getAdminProfile(req.admin!.id);
  res.status(200).json({ admin });
}

/** Stateless JWTs: the client discards its token. */
export function logoutHandler(_req: Request, res: Response): void {
  res.status(200).json({ message: 'Logged out' });
}
