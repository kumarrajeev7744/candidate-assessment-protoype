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

export interface DeviceAvailability {
  cameras: number;
  microphones: number;
}

/** Counts available cameras and microphones (labels are not needed). Null if it cannot be determined. */
export async function getDeviceAvailability(): Promise<DeviceAvailability | null> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return {
      cameras: devices.filter((d) => d.kind === 'videoinput').length,
      microphones: devices.filter((d) => d.kind === 'audioinput').length,
    };
  } catch {
    return null;
  }
}

/** Short technical detail (e.g. "NotFoundError: Requested device not found") to help troubleshooting. */
export function mediaErrorDetail(err: unknown): string {
  const e = err as { name?: string; message?: string } | null;
  return [e?.name, e?.message].filter(Boolean).join(': ') || 'Unknown error';
}

export function describeMediaError(err: unknown, devices: DeviceAvailability | null = null): string {
  const name = (err as { name?: string } | null)?.name;
  if ((name === 'NotFoundError' || name === 'OverconstrainedError') && devices) {
    if (devices.cameras === 0 && devices.microphones > 0) {
      return 'No camera was found. Please connect or enable a camera (on a MacBook, open the lid) and try again.';
    }
    if (devices.microphones === 0 && devices.cameras > 0) {
      return 'No microphone was found. Please connect or enable a microphone and try again.';
    }
    if (devices.cameras > 0 && devices.microphones > 0) {
      return 'Your camera or microphone could not be opened. Please check that your browser is allowed to use them in your system privacy settings (on a Mac: System Settings → Privacy & Security → Camera and Microphone), then restart the browser and try again.';
    }
  }
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Camera and microphone access was blocked. Please allow access in your browser settings (usually the camera icon in the address bar) and try again.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No camera or microphone was found. Please connect a camera and microphone and try again. On a Mac, also check System Settings → Privacy & Security → Camera and Microphone.';
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
