import { describe, it, expect } from 'vitest';
import { generateToken, hashToken } from '../src/utils/token.js';
import { addDays, isExpired } from '../src/utils/dates.js';

describe('token utilities', () => {
  it('generates unique URL-safe tokens with 256 bits of entropy', () => {
    const tokens = new Set(Array.from({ length: 100 }, generateToken));
    expect(tokens.size).toBe(100);
    for (const t of tokens) expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('hashes tokens deterministically with SHA-256', () => {
    const token = generateToken();
    expect(hashToken(token)).toBe(hashToken(token));
    expect(hashToken(token)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashToken(token)).not.toBe(hashToken(generateToken()));
  });
});

describe('date utilities', () => {
  it('adds days and checks expiry', () => {
    const start = new Date('2026-01-01T00:00:00Z');
    const expiry = addDays(start, 7);
    expect(expiry.toISOString()).toBe('2026-01-08T00:00:00.000Z');
    expect(isExpired(expiry, new Date('2026-01-07T23:59:59Z'))).toBe(false);
    expect(isExpired(expiry, expiry)).toBe(true);
  });
});
