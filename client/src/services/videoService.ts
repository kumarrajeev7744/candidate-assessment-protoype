import { apiRequest } from './apiClient';
import type { SavedResponse } from '../types/assessment';
import type { VideoPlayback, VideoUploadTarget } from '../types/video';

const questionPath = (questionId: string) => `/assessment/questions/${encodeURIComponent(questionId)}`;

export function requestVideoUploadUrl(
  token: string,
  questionId: string,
  input: { mimeType: string; sizeBytes: number },
): Promise<VideoUploadTarget> {
  return apiRequest<VideoUploadTarget>(`${questionPath(questionId)}/video-upload-url`, {
    method: 'POST',
    body: input,
    assessmentToken: token,
  });
}

export async function confirmVideoUpload(token: string, questionId: string, objectKey: string): Promise<SavedResponse> {
  const { response } = await apiRequest<{ response: SavedResponse }>(`${questionPath(questionId)}/video-confirm`, {
    method: 'POST',
    body: { objectKey },
    assessmentToken: token,
  });
  return response;
}

export function getVideoPlaybackUrl(token: string, questionId: string): Promise<VideoPlayback> {
  return apiRequest<VideoPlayback>(`${questionPath(questionId)}/video-url`, { assessmentToken: token });
}

/** Error from the direct browser-to-S3 upload. status 0 = network error. */
export class S3UploadError extends Error {
  constructor(public readonly status: number) {
    super(status === 0 ? 'Network error while uploading the video.' : `Video upload was rejected (HTTP ${status}).`);
    this.name = 'S3UploadError';
  }
}

export interface UploadHandle {
  promise: Promise<void>;
  abort: () => void;
}

/**
 * Uploads the video straight from the browser to S3 with the presigned URL
 * (XMLHttpRequest is used because fetch cannot report upload progress).
 */
export function putVideoToS3(target: VideoUploadTarget, blob: Blob, onProgress: (fraction: number) => void): UploadHandle {
  const xhr = new XMLHttpRequest();
  const promise = new Promise<void>((resolve, reject) => {
    xhr.open(target.method, target.uploadUrl);
    for (const [name, value] of Object.entries(target.headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (event: ProgressEvent) => {
      if (event.lengthComputable && event.total > 0) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(1);
        resolve();
      } else {
        reject(new S3UploadError(xhr.status));
      }
    };
    xhr.onerror = () => reject(new S3UploadError(0));
    xhr.onabort = () => reject(new S3UploadError(0));
    xhr.send(blob);
  });
  return { promise, abort: () => xhr.abort() };
}
