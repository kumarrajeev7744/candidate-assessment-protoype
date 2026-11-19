/** Preferred recording formats, best first. WebM: Chrome/Edge/Firefox. MP4: Safari. */
const CANDIDATE_MIME_TYPES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4',
];

export function isRecordingSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    Boolean(navigator.mediaDevices?.getUserMedia) &&
    typeof window !== 'undefined' &&
    typeof window.MediaRecorder !== 'undefined'
  );
}

/** Picks the first recording MIME type this browser supports ('' lets the browser choose). */
export function pickRecorderMimeType(): string {
  const isSupported = window.MediaRecorder?.isTypeSupported?.bind(window.MediaRecorder);
  if (!isSupported) return '';
  return CANDIDATE_MIME_TYPES.find((type) => isSupported(type)) ?? '';
}

/** "video/webm;codecs=vp8,opus" -> "video/webm" */
export function baseMimeType(mimeType: string): string {
  return mimeType.split(';')[0]!.trim().toLowerCase() || 'video/webm';
}

export function describeMediaError(err: unknown): string {
  const name = (err as { name?: string } | null)?.name;
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Camera and microphone access was blocked. Please allow access in your browser settings (usually the camera icon in the address bar) and try again.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No camera or microphone was found. Please connect a camera and microphone and try again.';
    case 'NotReadableError':
    case 'AbortError':
      return 'Your camera or microphone is being used by another application. Please close it and try again.';
    default:
      return 'We could not access your camera and microphone. Please check your device and try again.';
  }
}

export function stopStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop());
}

export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
