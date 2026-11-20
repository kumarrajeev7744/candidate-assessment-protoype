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

/** Query string for the recruiter candidate list (GET /api/invitations). */
export const listInvitationsQuerySchema = z.object({
  search: z
    .string({ error: 'search must be text' })
    .trim()
    .max(100, 'search must be at most 100 characters')
    .optional()
    .default(''),
  page: z.coerce
    .number({ error: 'page must be a number' })
    .int('page must be a whole number')
    .min(1, 'page must be at least 1')
    .max(10_000, 'page is too large')
    .optional()
    .default(1),
  limit: z.coerce
    .number({ error: 'limit must be a number' })
    .int('limit must be a whole number')
    .min(1, 'limit must be at least 1')
    .max(100, 'limit must be at most 100')
    .optional()
    .default(50),
});

export type ListInvitationsQuery = z.infer<typeof listInvitationsQuerySchema>;

export const shareResponseSchema = z.object({
  candidateId: z
    .string({ error: 'candidateId is required' })
    .trim()
    .regex(/^[a-f0-9]{24}$/i, 'candidateId is invalid'),
  recipientEmail: z
    .string({ error: 'Recipient email is required' })
    .trim()
    .min(1, 'Recipient email is required')
    .max(254, 'Recipient email is too long')
    .pipe(z.email({ error: 'Recipient email is invalid' }))
    .transform((v) => v.toLowerCase()),
});

export type ShareResponseInput = z.infer<typeof shareResponseSchema>;

export const shareReportSchema = z.object({
  recipientEmail: shareResponseSchema.shape.recipientEmail,
});

export type ShareReportInput = z.infer<typeof shareReportSchema>;

export const rejectCandidateSchema = z.object({
  reason: z
    .string({ error: 'Rejection reason is required' })
    .trim()
    .min(1, 'Rejection reason is required')
    .max(500, 'Rejection reason cannot exceed 500 characters'),
});

export type RejectCandidateInput = z.infer<typeof rejectCandidateSchema>;
