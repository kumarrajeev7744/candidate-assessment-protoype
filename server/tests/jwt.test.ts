import { describe, it, expect } from 'vitest';
import jwt from 'jsonwebtoken';
import { getJwtSecret, signAdminToken, verifyAdminToken } from '../src/utils/jwt.js';

const admin = { id: '665f1f77bcf86cd799439011', email: 'admin@example.com' };

describe('getJwtSecret', () => {
  it('rejects missing, short and placeholder secrets', () => {
    expect(() => getJwtSecret('')).toThrow(/JWT_SECRET is not set/);
    expect(() => getJwtSecret('too-short')).toThrow(/at least 32 characters/);
    expect(() => getJwtSecret('<generate-a-random-secret-of-at-least-32-characters>')).toThrow(/placeholder/);
  });

  it('accepts a strong secret', () => {
    const secret = 'x'.repeat(48);
    expect(getJwtSecret(secret)).toBe(secret);
  });
});

describe('signAdminToken / verifyAdminToken', () => {
  it('round-trips the admin identity with a 1-hour expiry', () => {
    const { token, expiresAt } = signAdminToken(admin);
    expect(verifyAdminToken(token)).toEqual(admin);
    const decoded = jwt.decode(token) as jwt.JwtPayload;
    expect(decoded.exp! - decoded.iat!).toBe(3600);
    expect(Math.abs(expiresAt.getTime() - decoded.exp! * 1000)).toBeLessThan(2000);
    expect(decoded).not.toHaveProperty('passwordHash');
  });

  it('rejects tokens signed with another secret', () => {
    const forged = jwt.sign({ email: admin.email }, 'another-secret-another-secret-123456', {
      subject: admin.id,
      audience: 'candidate-assessment-admin',
    });
    expect(() => verifyAdminToken(forged)).toThrow(jwt.JsonWebTokenError);
  });

  it('rejects the "none" algorithm', () => {
    const unsigned = jwt.sign({ email: admin.email, sub: admin.id, aud: 'candidate-assessment-admin' }, '', {
      algorithm: 'none',
    });
    expect(() => verifyAdminToken(unsigned)).toThrow(jwt.JsonWebTokenError);
  });

  it('rejects expired tokens', () => {
    const { token } = signAdminToken(admin, 1);
    const later = Date.now() + 5_000;
    const realNow = Date.now;
    Date.now = () => later;
    try {
      expect(() => verifyAdminToken(token)).toThrow(jwt.TokenExpiredError);
    } finally {
      Date.now = realNow;
    }
  });
});
