export interface VideoUploadTarget {
  uploadUrl: string;
  objectKey: string;
  method: 'PUT';
  headers: Record<string, string>;
  expiresAt: string;
}

export interface VideoPlayback {
  url: string;
  mimeType: string;
  expiresAt: string;
}

export interface AcceptedRecording {
  blob: Blob;
  mimeType: string;
  durationSeconds: number;
}
