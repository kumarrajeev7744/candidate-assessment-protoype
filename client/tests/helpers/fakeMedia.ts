import { vi } from 'vitest';

export interface FakeTrack {
  kind: string;
  stop: ReturnType<typeof vi.fn>;
  readyState: 'live' | 'ended';
}

export class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = [];
  static supportedTypes: string[] = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  static isTypeSupported = (type: string) => FakeMediaRecorder.supportedTypes.includes(type);

  state: 'inactive' | 'recording' = 'inactive';
  mimeType: string;
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  start = vi.fn(() => {
    this.state = 'recording';
  });
  stop = vi.fn(() => {
    if (this.state === 'inactive') return;
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['fake-video-bytes'.repeat(100)], { type: this.mimeType }) });
    this.onstop?.();
  });

  constructor(
    public stream: unknown,
    options?: { mimeType?: string },
  ) {
    this.mimeType = options?.mimeType || 'video/webm';
    FakeMediaRecorder.instances.push(this);
  }
}

/** Installs fake getUserMedia + MediaRecorder. `deny` makes getUserMedia reject with that DOMException name. */
export function installFakeMedia(options: { deny?: string; noMediaRecorder?: boolean } = {}) {
  const streams: Array<{ tracks: FakeTrack[] }> = [];
  FakeMediaRecorder.instances = [];
  FakeMediaRecorder.supportedTypes = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];

  const getUserMedia = vi.fn(async () => {
    if (options.deny) throw Object.assign(new Error(options.deny), { name: options.deny });
    const tracks: FakeTrack[] = ['video', 'audio'].map((kind) => {
      const track: FakeTrack = { kind, readyState: 'live', stop: vi.fn() };
      track.stop.mockImplementation(() => {
        track.readyState = 'ended';
      });
      return track;
    });
    streams.push({ tracks });
    return { getTracks: () => tracks } as unknown as MediaStream;
  });

  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
  if (options.noMediaRecorder) vi.stubGlobal('MediaRecorder', undefined);
  else vi.stubGlobal('MediaRecorder', FakeMediaRecorder);

  return {
    getUserMedia,
    streams,
    recorders: FakeMediaRecorder.instances,
    allTracks: () => streams.flatMap((s) => s.tracks),
    liveTracks: () => streams.flatMap((s) => s.tracks).filter((t) => t.readyState === 'live'),
  };
}

export function uninstallFakeMedia() {
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined });
}
