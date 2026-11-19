import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { VideoRecorder } from '../src/components/assessment/VideoRecorder';
import { FakeMediaRecorder, installFakeMedia, uninstallFakeMedia } from './helpers/fakeMedia';

afterEach(() => uninstallFakeMedia());

function renderRecorder(maxSeconds = 120) {
  const onAccept = vi.fn();
  const utils = render(<VideoRecorder maxSeconds={maxSeconds} onAccept={onAccept} />);
  return { onAccept, ...utils };
}

async function openCamera() {
  await userEvent.click(screen.getByRole('button', { name: 'Record video' }));
  await screen.findByLabelText('Camera preview');
}

describe('VideoRecorder', () => {
  it('requests camera and microphone permission and shows a live preview', async () => {
    const media = installFakeMedia();
    renderRecorder();
    expect(media.getUserMedia).not.toHaveBeenCalled(); // only on the candidate's action

    await openCamera();
    expect(media.getUserMedia).toHaveBeenCalledWith(
      expect.objectContaining({ video: expect.anything(), audio: expect.anything() }),
    );
    expect(screen.getByRole('button', { name: 'Start recording' })).toBeInTheDocument();
  });

  it.each([
    ['NotAllowedError', undefined, /access was blocked/],
    ['NotFoundError', [], /No camera or microphone was found/],
    ['NotFoundError', ['audioinput'], /^No camera was found/],
    ['NotFoundError', ['videoinput'], /^No microphone was found/],
    ['NotFoundError', ['videoinput', 'audioinput'], /Privacy & Security/],
    ['NotReadableError', undefined, /being used by another application/],
  ] as const)('shows a clear message for %s with devices %j', async (name, devices, message) => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    installFakeMedia({ deny: name, devices: devices ? [...devices] : undefined });
    renderRecorder();
    await userEvent.click(screen.getByRole('button', { name: 'Record video' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(screen.getByText(`Technical details: ${name}: ${name}`)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('falls back to default camera settings when the preferred ones are not available', async () => {
    const media = installFakeMedia();
    media.getUserMedia.mockRejectedValueOnce(Object.assign(new Error('x'), { name: 'OverconstrainedError' }));
    renderRecorder();
    await openCamera();
    expect(media.getUserMedia).toHaveBeenLastCalledWith({ video: true, audio: true });
  });

  it('explains when the browser cannot record video', async () => {
    installFakeMedia({ noMediaRecorder: true });
    renderRecorder();
    await userEvent.click(screen.getByRole('button', { name: 'Record video' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/not supported in this browser/);
  });

  it('starts and stops recording, then shows a local preview and releases the camera', async () => {
    const media = installFakeMedia();
    renderRecorder();
    await openCamera();

    await userEvent.click(screen.getByRole('button', { name: 'Start recording' }));
    const recorder = media.recorders[0]!;
    expect(recorder.start).toHaveBeenCalled();
    expect(recorder.mimeType).toBe('video/webm;codecs=vp9,opus');
    expect(screen.getByRole('timer')).toHaveTextContent('Recording 00:00 / 02:00');

    await userEvent.click(screen.getByRole('button', { name: 'Stop recording' }));
    expect(recorder.stop).toHaveBeenCalled();
    const preview = await screen.findByLabelText('Recorded video preview');
    expect(preview).toHaveAttribute('src', expect.stringMatching(/^blob:fake\//));
    expect(screen.getByRole('button', { name: 'Accept video' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Re-record' })).toBeInTheDocument();
    expect(media.liveTracks()).toHaveLength(0);
  });

  it('stops automatically at the 2-minute limit', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const media = installFakeMedia();
    renderRecorder(120);
    await user.click(screen.getByRole('button', { name: 'Record video' }));
    await screen.findByLabelText('Camera preview');
    await user.click(screen.getByRole('button', { name: 'Start recording' }));

    await act(async () => {
      vi.advanceTimersByTime(110_000);
    });
    expect(screen.getByRole('timer')).toHaveTextContent('Recording 01:50 / 02:00');
    expect(screen.getByText('Recording stops in 10s')).toBeInTheDocument();
    expect(media.recorders[0]!.stop).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    expect(media.recorders[0]!.stop).toHaveBeenCalledTimes(1);
    expect(await screen.findByLabelText('Recorded video preview')).toBeInTheDocument();
    expect(media.liveTracks()).toHaveLength(0);
  });

  it('hands the recording to onAccept only when accepted', async () => {
    installFakeMedia();
    const { onAccept } = renderRecorder();
    await openCamera();
    await userEvent.click(screen.getByRole('button', { name: 'Start recording' }));
    await userEvent.click(screen.getByRole('button', { name: 'Stop recording' }));
    await screen.findByLabelText('Recorded video preview');
    expect(onAccept).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Accept video' }));
    expect(onAccept).toHaveBeenCalledTimes(1);
    const [{ blob, mimeType, durationSeconds }] = onAccept.mock.calls[0]!;
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(0);
    expect(mimeType).toBe('video/webm');
    expect(durationSeconds).toBeGreaterThanOrEqual(0);
    expect(URL.revokeObjectURL).toHaveBeenCalled();
  });

  it('re-record discards the local recording and opens the camera again', async () => {
    const media = installFakeMedia();
    const { onAccept } = renderRecorder();
    await openCamera();
    await userEvent.click(screen.getByRole('button', { name: 'Start recording' }));
    await userEvent.click(screen.getByRole('button', { name: 'Stop recording' }));
    const firstUrl = (await screen.findByLabelText('Recorded video preview')).getAttribute('src');

    await userEvent.click(screen.getByRole('button', { name: 'Re-record' }));
    await screen.findByLabelText('Camera preview');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(firstUrl);
    expect(media.getUserMedia).toHaveBeenCalledTimes(2);

    await userEvent.click(screen.getByRole('button', { name: 'Start recording' }));
    await userEvent.click(screen.getByRole('button', { name: 'Stop recording' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Accept video' }));
    expect(onAccept).toHaveBeenCalledTimes(1); // only the accepted (second) recording
    expect(media.recorders).toHaveLength(2);
  });

  it('prefers MP4 (H.264 + AAC) when supported, so videos also play in Safari', async () => {
    const media = installFakeMedia();
    FakeMediaRecorder.supportedTypes = [
      'video/mp4;codecs=avc1,mp4a.40.2',
      'video/mp4',
      'video/webm;codecs=vp9,opus',
      'video/webm',
    ];
    const { onAccept } = renderRecorder();
    await openCamera();
    await userEvent.click(screen.getByRole('button', { name: 'Start recording' }));
    expect(media.recorders[0]!.mimeType).toBe('video/mp4;codecs=avc1,mp4a.40.2');
    await userEvent.click(screen.getByRole('button', { name: 'Stop recording' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Accept video' }));
    expect(onAccept.mock.calls[0]![0].mimeType).toBe('video/mp4');
  });

  it('uses WebM rather than MP4 without AAC audio (e.g. Chromium without an AAC encoder)', async () => {
    const media = installFakeMedia();
    FakeMediaRecorder.supportedTypes = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9,opus'];
    renderRecorder();
    await openCamera();
    await userEvent.click(screen.getByRole('button', { name: 'Start recording' }));
    expect(media.recorders[0]!.mimeType).toBe('video/webm;codecs=vp9,opus');
  });

  it('uses MP4 when the browser does not support WebM (Safari)', async () => {
    const media = installFakeMedia();
    FakeMediaRecorder.supportedTypes = ['video/mp4'];
    const { onAccept } = renderRecorder();
    await openCamera();
    await userEvent.click(screen.getByRole('button', { name: 'Start recording' }));
    expect(media.recorders[0]!.mimeType).toBe('video/mp4');
    await userEvent.click(screen.getByRole('button', { name: 'Stop recording' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Accept video' }));
    expect(onAccept.mock.calls[0]![0].mimeType).toBe('video/mp4');
  });

  it('releases camera and microphone tracks on unmount (live preview)', async () => {
    const media = installFakeMedia();
    const { unmount } = renderRecorder();
    await openCamera();
    expect(media.liveTracks()).toHaveLength(2);
    unmount();
    expect(media.liveTracks()).toHaveLength(0);
    media.allTracks().forEach((t) => expect(t.stop).toHaveBeenCalled());
  });

  it('stops the recorder and releases tracks on unmount while recording', async () => {
    const media = installFakeMedia();
    const { unmount } = renderRecorder();
    await openCamera();
    await userEvent.click(screen.getByRole('button', { name: 'Start recording' }));
    unmount();
    expect(media.recorders[0]!.stop).toHaveBeenCalled();
    expect(media.liveTracks()).toHaveLength(0);
  });

  it('cancel releases the camera without recording', async () => {
    const media = installFakeMedia();
    renderRecorder();
    await openCamera();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(media.liveTracks()).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Record video' })).toBeInTheDocument();
  });
});
