import mongoose from 'mongoose';
import { Candidate, Invitation, Question, Response, ShareLink } from '../models/index.js';
import { AppError } from '../utils/AppError.js';
import { logger } from '../utils/logger.js';
import { assertObjectId } from './reportService.js';
import { getVideoStorage, isVideoStorageConfigured } from './storage/videoStorage.js';
import { legacyVideoKeyPrefix, videoKeyPrefix } from './videoService.js';

export interface DeletionResult {
  deleted: { candidate: number; invitations: number; responses: number; shareLinks: number; videos: number };
}

/**
 * Permanently deletes a candidate and everything stored for them:
 * all of their videos in S3 (including replaced or abandoned uploads), then — in one MongoDB
 * transaction — their share links, responses, invitation and candidate record.
 *
 * S3 is cleaned first. If any video cannot be deleted, nothing is removed from MongoDB, so the
 * recruiter can simply retry and no stored file is left without a record pointing to it.
 */
export async function deleteCandidate(candidateId: string): Promise<DeletionResult> {
  assertObjectId(candidateId, 'candidate');
  const candidate = await Candidate.findById(candidateId).select('_id').lean();
  if (!candidate) throw new AppError(404, 'Candidate not found.', 'CANDIDATE_NOT_FOUND');

  const responses = await Response.find({ candidateId: candidate._id }).select('_id video.objectKey').lean();

  // 1. Every video key: those referenced by responses, plus anything under this candidate's folders.
  const keys = new Set<string>();
  for (const r of responses) if (r.video?.objectKey) keys.add(r.video.objectKey);
  const storageConfigured = isVideoStorageConfigured();
  if (!storageConfigured && keys.size > 0) {
    throw new AppError(503, 'Video storage is not configured, so the candidate’s videos cannot be deleted.', 'VIDEO_STORAGE_NOT_CONFIGURED');
  }

  let videosDeleted = 0;
  if (storageConfigured) {
    const storage = getVideoStorage();
    try {
      const questionIds = await Question.find().select('_id').lean();
      const prefixes = questionIds.map((q) => videoKeyPrefix(candidateId, q._id.toString()));
      // Videos uploaded before opaque keys were introduced live under videos/{candidateId}/.
      prefixes.push(legacyVideoKeyPrefix(candidateId));
      for (const prefix of prefixes) {
        for (const key of await storage.listObjectKeys(prefix)) keys.add(key);
      }
    } catch (err) {
      logger.error('Could not list candidate videos for deletion', { candidateId, error: err instanceof Error ? err.name : 'UnknownError' });
      throw new AppError(502, 'The candidate’s videos could not be listed in storage. Nothing was deleted. Please try again.', 'VIDEO_DELETE_FAILED');
    }

    const failed: string[] = [];
    for (const key of keys) {
      try {
        await storage.deleteObject(key);
        videosDeleted += 1;
      } catch {
        failed.push(key);
      }
    }
    if (failed.length > 0) {
      logger.error('Could not delete candidate videos', { candidateId, failed: failed.length, deleted: videosDeleted });
      throw new AppError(
        502,
        `${failed.length} video file(s) could not be deleted from storage. The candidate was not deleted; please try again.`,
        'VIDEO_DELETE_FAILED',
      );
    }
  }

  // 2. Database records, all or nothing.
  const responseIds = responses.map((r) => r._id);
  const deleted = await mongoose.connection.transaction(async (session) => {
    const shareLinks = await ShareLink.deleteMany(
      { $or: [{ candidateId: candidate._id }, { responseId: { $in: responseIds } }] },
      { session },
    );
    const responsesResult = await Response.deleteMany({ candidateId: candidate._id }, { session });
    const invitations = await Invitation.deleteMany({ candidateId: candidate._id }, { session });
    const candidates = await Candidate.deleteOne({ _id: candidate._id }, { session });
    return {
      candidate: candidates.deletedCount,
      invitations: invitations.deletedCount,
      responses: responsesResult.deletedCount,
      shareLinks: shareLinks.deletedCount,
      videos: videosDeleted,
    };
  });

  logger.info('Candidate deleted', { candidateId, ...deleted });
  return { deleted };
}
