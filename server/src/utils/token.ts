import { createHash, randomBytes } from 'node:crypto';

/** Number of random bytes in invitation/share tokens (256 bits of entropy). */
const TOKEN_BYTES = 32;

/** Generates a cryptographically secure, URL-safe token. Only send this to the user; never store it. */
export function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

/** SHA-256 hash (hex) of a token. This is the only form persisted in the database. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
