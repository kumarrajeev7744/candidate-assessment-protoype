import { describe, it, expect } from 'vitest';
import bcrypt from 'bcryptjs';
import { useTestDatabase } from './helpers/db.js';
import { Admin } from '../src/models/index.js';
import { seedAdmin, validateAdminSeedInput } from '../src/services/adminSeedService.js';

useTestDatabase();

const PASSWORD = 'Initial-Password-123';

describe('validateAdminSeedInput', () => {
  it('requires both values', () => {
    expect(() => validateAdminSeedInput(undefined, undefined)).toThrow(/ADMIN_EMAIL is required.*ADMIN_PASSWORD is required/);
  });

  it('rejects an invalid email', () => {
    expect(() => validateAdminSeedInput('nope', PASSWORD)).toThrow(/valid email/);
  });

  it('rejects short, placeholder and over-long passwords without echoing them', () => {
    const attempts = ['short', '<choose-a-strong-password-min-12-chars>', 'é'.repeat(40)];
    for (const pw of attempts) {
      let message = '';
      try {
        validateAdminSeedInput('admin@example.com', pw);
      } catch (err) {
        message = (err as Error).message;
      }
      expect(message).toMatch(/ADMIN_PASSWORD/);
      expect(message).not.toContain(pw);
    }
  });
});

describe('seedAdmin', () => {
  it('creates the admin with a bcrypt hash (not the plaintext password)', async () => {
    const outcome = await seedAdmin(' Admin@Example.com ', PASSWORD);
    expect(outcome).toEqual({ status: 'created', email: 'admin@example.com' });

    const admin = await Admin.findOne({ email: 'admin@example.com' }).select('+passwordHash');
    expect(admin?.passwordHash).toMatch(/^\$2[aby]\$12\$/);
    expect(admin?.passwordHash).not.toContain(PASSWORD);
    expect(await bcrypt.compare(PASSWORD, admin!.passwordHash)).toBe(true);
  });

  it('is idempotent and never overwrites an existing password', async () => {
    await seedAdmin('admin@example.com', PASSWORD);
    const before = await Admin.findOne({ email: 'admin@example.com' }).select('+passwordHash');

    const outcome = await seedAdmin('admin@example.com', 'A-Different-Password-456');
    expect(outcome).toEqual({ status: 'exists', email: 'admin@example.com' });

    const after = await Admin.findOne({ email: 'admin@example.com' }).select('+passwordHash');
    expect(await Admin.countDocuments()).toBe(1);
    expect(after?.passwordHash).toBe(before?.passwordHash);
    expect(after?.updatedAt.getTime()).toBe(before?.updatedAt.getTime());
  });
});
