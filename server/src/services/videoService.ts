import { randomBytes } from 'node:crypto';
import { Types } from 'mongoose';
import { config } from '../config/env.js';
import { Question, Response } from '../models/index.js';
import { AppError } from '../utils/AppError.js';
import { logger } from '../utils/logger.js';
import type { CandidateSession } from '../types/assessment.js';
import { getVideoStorage } from './storage/videoStorage.js';
import { toResponseDto, type SavedResponseDto } from './assessmentService.js';
import { withResponseWriteLock } from './responseLock.js';

/** Container formats browsers record with MediaRecorder (Chrome/Firefox: WebM, Safari: MP4). */
export const ALLOWED_VIDEO_TYPES: Record<string, string> = {
  'video/webm': 'webm',
  'video/mp4': 'mp4',
};

/** "video/webm;codecs=vp8,opus" -> "video/webm". Returns null if not allowed. */
export function normalizeVideoMimeType(mimeType: string): string | null {
  const base = mimeType.split(';')[0]!.trim().toLowerCase();
  return base in ALLOWED_VIDEO_TYPES ? base : null;
}

function keyPrefix(session: CandidateSession, questionId: string): string {
  return `videos/${session.candidateId.toString()}/${questionId}/`;
}

/** Server-generated, unguessable object key scoped to the candidate and question. */
export function buildVideoObjectKey(session: CandidateSession, questionId: string, mimeType: string): string {
  const ext = ALLOWED_VIDEO_TYPES[mimeType]!;
  return `${keyPrefix(session, questionId)}${Date.now()}-${randomBytes(12).toString('hex')}.${ext}`;
}

const OBJECT_KEY_PATTERN = /^videos\/[a-f0-9]{24}\/[a-f0-9]{24}\/\d{13}-[a-f0-9]{24}\.(webm|mp4)$/;

function assertInProgress(session: CandidateSession): void {
  if (session.status !== 'In Progress') {
    throw new AppError(409, 'Please start the assessment before recording videos.', 'ASSESSMENT_NOT_STARTED');
  }
}

async function assertActiveQuestion(questionId: string): Promise<void> {
  if (!/^[a-f0-9]{24}$/i.test(questionId)) throw new AppError(400, 'Invalid question ID.', 'INVALID_ID');
  if (!(await Question.exists({ _id: questionId, isActive: true }))) {
    throw new AppError(404, 'Question not found.', 'QUESTION_NOT_FOUND');
  }
}

export interface UploadUrlResult {
  uploadUrl: string;
  objectKey: string;
  method: 'PUT';
  headers: Record<string, string>;
  expiresAt: string;
}

export async function createVideoUploadUrl(
  session: CandidateSession,
  questionId: string,
  input: { mimeType: string; sizeBytes: number },
): Promise<UploadUrlResult> {
  assertInProgress(session);
  await assertActiveQuestion(questionId);

  const contentType = normalizeVideoMimeType(input.mimeType);
  if (!contentType) {
    throw new AppError(400, 'This video format is not supported. Please use a recent version of Chrome, Edge, Firefox or Safari.', 'UNSUPPORTED_VIDEO_TYPE');
  }
  if (input.sizeBytes > config.video.maxBytes) {
    throw new AppError(
      400,
      `The video is too large (maximum ${Math.round(config.video.maxBytes / 1024 / 1024)} MB).`,
      'VIDEO_TOO_LARGE',
    );
  }

  const storage = getVideoStorage();
  const objectKey = buildVideoObjectKey(session, questionId.toLowerCase(), contentType);
  const expiresIn = config.video.urlExpiresInSeconds;
  const uploadUrl = await storage.createUploadUrl(objectKey, contentType, input.sizeBytes, expiresIn);
  return {
    uploadUrl,
    objectKey,
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
  };
}

/**
 * Verifies an uploaded object in S3 and makes it the question's active video.
 * The previous video (if any) is deleted afterwards; deletion failures are only logged.
 */
export async function confirmVideoUpload(
  session: CandidateSession,
  questionId: string,
  objectKey: string,
): Promise<SavedResponseDto> {
  assertInProgress(session);
  await assertActiveQuestion(questionId);
  const qid = questionId.toLowerCase();

  // Only keys generated for this candidate and question are accepted.
  if (!OBJECT_KEY_PATTERN.test(objectKey) || !objectKey.startsWith(keyPrefix(session, qid))) {
    throw new AppError(403, 'This video does not belong to this question.', 'INVALID_OBJECT_KEY');
  }

  const storage = getVideoStorage();
  const head = await storage.headObject(objectKey);
  if (!head) {
    throw new AppError(409, 'The video upload was not found. Please upload it again.', 'VIDEO_NOT_UPLOADED');
  }
  const contentType = head.contentType ? normalizeVideoMimeType(head.contentType) : null;
  const expectedType = ALLOWED_VIDEO_TYPES[contentType ?? ''] === objectKey.split('.').pop() ? contentType : null;
  if (!expectedType || head.sizeBytes <= 0 || head.sizeBytes > config.video.maxBytes) {
    await storage.deleteObject(objectKey).catch(() => undefined);
    throw new AppError(400, 'The uploaded video is invalid. Please record it again.', 'INVALID_VIDEO_UPLOAD');
  }

  const filter = { candidateId: session.candidateId, questionId: new Types.ObjectId(qid) };
  const video = {
    objectKey,
    mimeType: expectedType,
    sizeBytes: head.sizeBytes,
    uploadStatus: 'Uploaded' as const,
    uploadedAt: new Date(),
  };
  // Locked write: a video can never be attached or replaced after the assessment is submitted.
  const { saved, previousKey, unchanged } = await withResponseWriteLock(session, async (dbSession) => {
    const existing = await Response.findOne(filter).select('video').session(dbSession).lean();
    const previous = existing?.video?.objectKey;
    if (previous === objectKey && existing?.video?.uploadStatus === 'Uploaded') {
      const current = await Response.findOne(filter).session(dbSession).lean();
      return { saved: current, previousKey: previous, unchanged: true }; // idempotent re-confirm
    }
    const updated = await Response.findOneAndUpdate(
      filter,
      { $set: { video }, $setOnInsert: filter },
      {
        upsert: true,
        returnDocument: 'after',
        runValidators: true,
        setDefaultsOnInsert: true,
        lean: true,
        session: dbSession,
      },
    );
    return { saved: updated, previousKey: previous, unchanged: false };
  });
  if (unchanged) return toResponseDto(saved!);
  logger.info('Video upload confirmed', { questionId: qid, sizeBytes: head.sizeBytes, replaced: Boolean(previousKey) });

  if (previousKey && previousKey !== objectKey) {
    try {
      await storage.deleteObject(previousKey);
    } catch (err) {
      // Never fail the candidate's workflow: the old object is left for later cleanup.
      logger.warn('Failed to delete replaced video', {
        questionId: qid,
        error: err instanceof Error ? err.name : 'UnknownError',
      });
    }
  }
  return toResponseDto(saved!);
}

export async function getVideoPlaybackUrl(
  session: CandidateSession,
  questionId: string,
): Promise<{ url: string; mimeType: string; expiresAt: string }> {
  await assertActiveQuestion(questionId);
  const response = await Response.findOne({
    candidateId: session.candidateId,
    questionId: new Types.ObjectId(questionId.toLowerCase()),
  })
    .select('video')
    .lean();
  const video = response?.video;
  if (!video || video.uploadStatus !== 'Uploaded') {
    throw new AppError(404, 'No video has been uploaded for this question.', 'VIDEO_NOT_FOUND');
  }
  const expiresIn = config.video.urlExpiresInSeconds;
  const url = await getVideoStorage().createDownloadUrl(video.objectKey, video.mimeType, expiresIn);
  return { url, mimeType: video.mimeType, expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString() };
}
