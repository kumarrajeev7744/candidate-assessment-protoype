import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../services/apiClient';
import {
  confirmVideoUpload,
  putVideoToS3,
  requestVideoUploadUrl,
  S3UploadError,
} from '../services/videoService';
import type { SavedResponse } from '../types/assessment';
import type { AcceptedRecording, VideoUploadTarget } from '../types/video';

/** Initial attempt + 2 retries. Delays (ms) before each retry; tests shorten them. */
export const videoUploadSettings = { maxAttempts: 3, retryDelaysMs: [1500, 3000] };

export type UploadPhase = 'idle' | 'uploading' | 'confirming' | 'waiting-retry' | 'failed' | 'done';

export interface UploadState {
  phase: UploadPhase;
  attempt: number;
  progress: number;
  error: string | null;
}

const IDLE: UploadState = { phase: 'idle', attempt: 0, progress: 0, error: null };

function isRetryable(err: unknown): boolean {
  if (err instanceof S3UploadError) return true; // network errors, 5xx, expired URL (403)
  if (err instanceof ApiError) return err.status === 0 || err.status >= 500 || err.code === 'VIDEO_NOT_UPLOADED';
  return false;
}

function describeFailure(err: unknown): string {
  if (err instanceof ApiError && err.status !== 0 && err.status < 500) return err.message;
  return 'The video could not be uploaded. Please check your internet connection.';
}

interface Options {
  token: string;
  questionId: string;
  onUploaded: (response: SavedResponse) => void;
  /** Lets the caller end the session for invalid/expired/submitted links. Returns true if handled. */
  onFatalError: (err: unknown) => boolean;
}

/**
 * Uploads an accepted recording directly to S3 via a presigned URL, then confirms it with the API.
 * Makes one attempt plus up to two automatic retries, keeping the Blob in memory throughout.
 */
export function useVideoUpload({ token, questionId, onUploaded, onFatalError }: Options) {
  const [state, setState] = useState<UploadState>(IDLE);
  const recordingRef = useRef<AcceptedRecording | null>(null);
  const abortRef = useRef<(() => void) | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
      abortRef.current?.();
    };
  }, []);

  const run = useCallback(async () => {
    const recording = recordingRef.current;
    if (!recording) return false;
    let target: VideoUploadTarget | null = null;
    let uploadedToS3 = false;

    for (let attempt = 1; attempt <= videoUploadSettings.maxAttempts; attempt++) {
      if (cancelledRef.current) return false;
      setState({ phase: 'uploading', attempt, progress: uploadedToS3 ? 1 : 0, error: null });
      try {
        if (!target || Date.parse(target.expiresAt) - Date.now() < 60_000) {
          target = await requestVideoUploadUrl(token, questionId, {
            mimeType: recording.mimeType,
            sizeBytes: recording.blob.size,
          });
          uploadedToS3 = false;
        }
        if (!uploadedToS3) {
          const handle = putVideoToS3(target, recording.blob, (fraction) => {
            if (!cancelledRef.current) setState((s) => ({ ...s, progress: fraction }));
          });
          abortRef.current = handle.abort;
          await handle.promise;
          abortRef.current = null;
          uploadedToS3 = true;
        }
        setState((s) => ({ ...s, phase: 'confirming', progress: 1 }));
        const saved = await confirmVideoUpload(token, questionId, target.objectKey);
        if (cancelledRef.current) return false;
        recordingRef.current = null; // release the Blob once it is safely stored
        setState({ phase: 'done', attempt, progress: 1, error: null });
        onUploaded(saved);
        return true;
      } catch (err) {
        abortRef.current = null;
        if (cancelledRef.current) return false;
        if (onFatalError(err)) return false;
        if (err instanceof S3UploadError && err.status === 403) target = null; // URL expired: get a new one
        if (err instanceof ApiError && err.code === 'VIDEO_NOT_UPLOADED') uploadedToS3 = false;
        if (!isRetryable(err) || attempt === videoUploadSettings.maxAttempts) {
          setState({
            phase: 'failed',
            attempt,
            progress: 0,
            error: isRetryable(err)
              ? `Upload failed after ${attempt} attempts. ${describeFailure(err)}`
              : describeFailure(err),
          });
          return false;
        }
        setState({ phase: 'waiting-retry', attempt, progress: 0, error: describeFailure(err) });
        await new Promise((r) => setTimeout(r, videoUploadSettings.retryDelaysMs[attempt - 1] ?? 0));
      }
    }
    return false;
  }, [token, questionId, onUploaded, onFatalError]);

  /** Starts uploading a newly accepted recording. */
  const upload = useCallback(
    (recording: AcceptedRecording) => {
      recordingRef.current = recording;
      return run();
    },
    [run],
  );

  /** Starts a fresh upload cycle with the same recording after all retries failed. */
  const retry = useCallback(() => run(), [run]);

  /** Discards the kept recording (candidate chose to re-record). */
  const reset = useCallback(() => {
    recordingRef.current = null;
    setState(IDLE);
  }, []);

  return { state, upload, retry, reset, maxAttempts: videoUploadSettings.maxAttempts };
}
