import { z } from 'zod';

export const loginSchema = z.object({
  email: z
    .string({ error: 'Email is required' })
    .trim()
    .min(1, 'Email is required')
    .max(254, 'Email is too long')
    .pipe(z.email({ error: 'Email is invalid' }))
    .transform((v) => v.toLowerCase()),
  password: z
    .string({ error: 'Password is required' })
    .min(1, 'Password is required')
    .max(200, 'Password is too long'),
});

export type LoginInput = z.infer<typeof loginSchema>;
