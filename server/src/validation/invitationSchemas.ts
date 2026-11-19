import { z } from 'zod';

export const createInvitationSchema = z.object({
  name: z
    .string({ error: 'Name is required' })
    .trim()
    .min(1, 'Name is required')
    .max(200, 'Name must be at most 200 characters')
    .refine((v) => !/[<>]/.test(v), 'Name contains invalid characters'),
  email: z
    .string({ error: 'Email is required' })
    .trim()
    .min(1, 'Email is required')
    .max(254, 'Email is too long')
    .pipe(z.email({ error: 'Email is invalid' }))
    .transform((v) => v.toLowerCase()),
});

export type CreateInvitationInput = z.infer<typeof createInvitationSchema>;
