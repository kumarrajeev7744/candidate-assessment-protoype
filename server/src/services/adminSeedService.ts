import { z } from 'zod';
import { Admin } from '../models/index.js';
import { hashPassword } from './authService.js';

export const MIN_ADMIN_PASSWORD_LENGTH = 12;
/** bcrypt only uses the first 72 bytes of a password. */
const MAX_BCRYPT_BYTES = 72;

const adminSeedSchema = z.object({
  email: z
    .string({ error: 'ADMIN_EMAIL is required' })
    .trim()
    .min(1, 'ADMIN_EMAIL is required')
    .pipe(z.email({ error: 'ADMIN_EMAIL must be a valid email address' }))
    .transform((v) => v.toLowerCase()),
  password: z
    .string({ error: 'ADMIN_PASSWORD is required' })
    .min(MIN_ADMIN_PASSWORD_LENGTH, `ADMIN_PASSWORD must be at least ${MIN_ADMIN_PASSWORD_LENGTH} characters`)
    .refine((p) => Buffer.byteLength(p, 'utf8') <= MAX_BCRYPT_BYTES, {
      message: `ADMIN_PASSWORD must be at most ${MAX_BCRYPT_BYTES} bytes`,
    })
    .refine((p) => !/change[-_ ]?me|<.*>/i.test(p), {
      message: 'ADMIN_PASSWORD still contains a placeholder value',
    }),
});

export type AdminSeedOutcome = { status: 'created' | 'exists'; email: string };

/** Validates ADMIN_EMAIL / ADMIN_PASSWORD values. Error messages never include the password. */
export function validateAdminSeedInput(email: string | undefined, password: string | undefined) {
  const result = adminSeedSchema.safeParse({ email, password });
  if (!result.success) {
    throw new Error(result.error.issues.map((i) => i.message).join('; '));
  }
  return result.data;
}

/**
 * Creates the admin if it does not exist. An existing admin is left untouched
 * (its password is never overwritten automatically).
 */
export async function seedAdmin(
  email: string | undefined,
  password: string | undefined,
): Promise<AdminSeedOutcome> {
  const input = validateAdminSeedInput(email, password);
  const existing = await Admin.exists({ email: input.email });
  if (existing) return { status: 'exists', email: input.email };

  await Admin.create({ email: input.email, passwordHash: await hashPassword(input.password) });
  return { status: 'created', email: input.email };
}
