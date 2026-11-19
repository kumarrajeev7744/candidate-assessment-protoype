import { config } from '../config/env.js';
import type { VideoUploadStatus } from '../models/index.js';
import { logger } from '../utils/logger.js';
import { getVideoStorage } from './storage/videoStorage.js';

/** Client-safe video info: never contains the S3 object key. */
export interface VideoPlaybackDto {
  status: VideoUploadStatus | 'Missing';
  available: boolean;
  url: string | null;
  mimeType: string | null;
  urlExpiresAt: string | null;
}

/** Builds playback info with a short-lived presigned GET URL for an uploaded video. */
export async function toVideoPlayback(
  video: { objectKey: string; mimeType: string; uploadStatus: VideoUploadStatus } | null | undefined,
): Promise<VideoPlaybackDto> {
  if (!video) return { status: 'Missing', available: false, url: null, mimeType: null, urlExpiresAt: null };
  if (video.uploadStatus !== 'Uploaded') {
    return { status: video.uploadStatus, available: false, url: null, mimeType: null, urlExpiresAt: null };
  }
  const expiresIn = config.video.urlExpiresInSeconds;
  try {
    const url = await getVideoStorage().createDownloadUrl(video.objectKey, video.mimeType, expiresIn);
    return {
      status: 'Uploaded',
      available: true,
      url,
      mimeType: video.mimeType,
      urlExpiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    };
  } catch (err) {
    // The rest of the page still works; the player shows that the video is unavailable right now.
    logger.error('Could not create video playback URL', { error: err instanceof Error ? err.name : 'UnknownError' });
    return { status: 'Uploaded', available: true, url: null, mimeType: video.mimeType, urlExpiresAt: null };
  }
}
