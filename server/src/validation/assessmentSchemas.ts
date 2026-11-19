import { z } from 'zod';
import { WRITTEN_ANSWER_MAX_LENGTH } from '../models/constants.js';

/** Only writtenAnswer is accepted; any other keys (e.g. candidateId) are stripped. */
export const saveResponseSchema = z.object({
  writtenAnswer: z
    .string({ error: 'Written answer must be a string' })
    .max(WRITTEN_ANSWER_MAX_LENGTH, `Written answer cannot exceed ${WRITTEN_ANSWER_MAX_LENGTH} characters`),
});

export type SaveResponseInput = z.infer<typeof saveResponseSchema>;
