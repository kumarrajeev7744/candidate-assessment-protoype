import jwt from 'jsonwebtoken';
import { config } from '../config/env.js';
import type { AuthenticatedAdmin } from '../types/auth.js';

export const MIN_JWT_SECRET_LENGTH = 32;
const ALGORITHM = 'HS256';
const AUDIENCE = 'candidate-assessment-admin';

/** Returns the JWT secret, throwing if it is missing or too weak. */
export function getJwtSecret(secret: string | undefined = config.jwtSecret): string {
  if (!secret) {
    throw new Error('JWT_SECRET is not set. Add it to server/.env (see server/.env.example).');
  }
  if (secret.length < MIN_JWT_SECRET_LENGTH) {
    throw new Error(`JWT_SECRET must be at least ${MIN_JWT_SECRET_LENGTH} characters long.`);
  }
  if (/change[-_ ]?me|replace[-_ ]?with|<.*>/i.test(secret)) {
    throw new Error('JWT_SECRET still contains a placeholder value. Generate a random secret.');
  }
  return secret;
}

export interface SignedToken {
  token: string;
  expiresAt: Date;
}

export function signAdminToken(
  admin: AuthenticatedAdmin,
  expiresInSeconds: number = config.jwtExpiresInSeconds,
): SignedToken {
  const token = jwt.sign({ email: admin.email }, getJwtSecret(), {
    algorithm: ALGORITHM,
    audience: AUDIENCE,
    subject: admin.id,
    expiresIn: expiresInSeconds,
  });
  return { token, expiresAt: new Date(Date.now() + expiresInSeconds * 1000) };
}

/** Verifies signature, algorithm, audience and expiry. Throws a jsonwebtoken error if invalid. */
export function verifyAdminToken(token: string): AuthenticatedAdmin {
  const payload = jwt.verify(token, getJwtSecret(), { algorithms: [ALGORITHM], audience: AUDIENCE });
  if (typeof payload === 'string' || !payload.sub || typeof payload.email !== 'string') {
    throw new jwt.JsonWebTokenError('Invalid token payload');
  }
  return { id: payload.sub, email: payload.email };
}
