import { z } from 'zod';
import { WRITTEN_ANSWER_MAX_LENGTH } from '../models/constants.js';

/** Only writtenAnswer is accepted; any other keys (e.g. candidateId) are stripped. */
export const saveResponseSchema = z.object({
  writtenAnswer: z
    .string({ error: 'Written answer must be a string' })
    .max(WRITTEN_ANSWER_MAX_LENGTH, `Written answer cannot exceed ${WRITTEN_ANSWER_MAX_LENGTH} characters`),
});

export type SaveResponseInput = z.infer<typeof saveResponseSchema>;

export const videoUploadUrlSchema = z.object({
  mimeType: z.string({ error: 'mimeType is required' }).trim().min(1, 'mimeType is required').max(100),
  sizeBytes: z
    .number({ error: 'sizeBytes must be a number' })
    .int('sizeBytes must be a whole number')
    .positive('The video is empty. Please record again.'),
});

export const videoConfirmSchema = z.object({
  objectKey: z.string({ error: 'objectKey is required' }).trim().min(1, 'objectKey is required').max(300),
});

export type VideoUploadUrlInput = z.infer<typeof videoUploadUrlSchema>;
export type VideoConfirmInput = z.infer<typeof videoConfirmSchema>;
