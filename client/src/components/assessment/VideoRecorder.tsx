import { useCallback, useEffect, useRef, useState } from 'react';
import type { AcceptedRecording } from '../../types/video';
import {
  baseMimeType,
  describeMediaError,
  formatDuration,
  getDeviceAvailability,
  mediaErrorDetail,
  isRecordingSupported,
  pickRecorderMimeType,
  stopStream,
} from '../../utils/media';
import { Icon } from '../ui/Icon';

type RecorderPhase = 'idle' | 'requesting' | 'live' | 'recording' | 'preview' | 'error';

interface Props {
  maxSeconds: number;
  /** Called only when the candidate accepts the previewed recording. */
  onAccept: (recording: AcceptedRecording) => void;
  /** Reports whether a recording is in progress or awaiting accept (used to guard navigation). */
  onActiveChange?: (active: boolean) => void;
  startLabel?: string;
}

/**
 * Records one video answer with getUserMedia + MediaRecorder: live preview, timer,
 * automatic stop at maxSeconds, local playback, then Accept or Re-record.
 * Camera/microphone are released as soon as recording stops and on unmount.
 */
export function VideoRecorder({ maxSeconds, onAccept, onActiveChange, startLabel = 'Record video' }: Props) {
  const [phase, setPhase] = useState<RecorderPhase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordingRef = useRef<{ blob: Blob; mimeType: string; durationSeconds: number } | null>(null);
  const startedAtRef = useRef(0);
  const tickRef = useRef<number | undefined>(undefined);
  const limitRef = useRef<number | undefined>(undefined);
  const liveVideoRef = useRef<HTMLVideoElement | null>(null);
  const previewUrlRef = useRef<string | null>(null);

  const clearTimers = () => {
    window.clearInterval(tickRef.current);
    window.clearTimeout(limitRef.current);
  };

  const releaseCamera = useCallback(() => {
    stopStream(streamRef.current);
    streamRef.current = null;
  }, []);

  const revokePreview = useCallback(() => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = null;
    setPreviewUrl(null);
  }, []);

  // Full cleanup on unmount.
  useEffect(
    () => () => {
      clearTimers();
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== 'inactive') {
        recorder.ondataavailable = null;
        recorder.onstop = null;
        recorder.stop();
      }
      stopStream(streamRef.current);
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    },
    [],
  );

  useEffect(() => {
    onActiveChange?.(phase === 'recording' || phase === 'preview');
  }, [phase, onActiveChange]);

  // Attach the live camera stream to the preview element.
  useEffect(() => {
    if ((phase === 'live' || phase === 'recording') && liveVideoRef.current) {
      liveVideoRef.current.srcObject = streamRef.current;
    }
  }, [phase]);

  const openCamera = useCallback(async () => {
    setError(null);
    setErrorDetail(null);
    revokePreview();
    recordingRef.current = null;
    if (!isRecordingSupported()) {
      setError('Video recording is not supported in this browser. Please use a recent version of Chrome, Edge, Firefox or Safari.');
      setPhase('error');
      return;
    }
    setPhase('requesting');
    try {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
          audio: { echoCancellation: true, noiseSuppression: true },
        });
      } catch (err) {
        // Some devices reject the preferred settings: fall back to the browser defaults once.
        const name = (err as { name?: string } | null)?.name;
        if (name !== 'OverconstrainedError' && name !== 'NotFoundError') throw err;
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      }
      streamRef.current = stream;
      setPhase('live');
    } catch (err) {
      releaseCamera();
      const devices = await getDeviceAvailability();
      console.warn('Camera/microphone access failed:', mediaErrorDetail(err), devices);
      setError(describeMediaError(err, devices));
      setErrorDetail(mediaErrorDetail(err));
      setPhase('error');
    }
  }, [releaseCamera, revokePreview]);

  const stopRecording = useCallback(() => {
    clearTimers();
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
  }, []);

  const startRecording = useCallback(() => {
    const stream = streamRef.current;
    if (!stream) return;
    const preferred = pickRecorderMimeType();
    let recorder: MediaRecorder;
    try {
      recorder = preferred ? new MediaRecorder(stream, { mimeType: preferred }) : new MediaRecorder(stream);
    } catch {
      setError('Video recording could not be started in this browser.');
      releaseCamera();
      setPhase('error');
      return;
    }
    chunksRef.current = [];
    recorder.ondataavailable = (event: BlobEvent) => {
      if (event.data && event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      const durationSeconds = Math.min(maxSeconds, Math.round((Date.now() - startedAtRef.current) / 1000));
      const mimeType = baseMimeType(recorder.mimeType || preferred);
      const blob = new Blob(chunksRef.current, { type: mimeType });
      chunksRef.current = [];
      releaseCamera(); // release camera/microphone as soon as recording is complete
      if (blob.size === 0) {
        setError('The recording was empty. Please try again.');
        setPhase('error');
        return;
      }
      recordingRef.current = { blob, mimeType, durationSeconds };
      const url = URL.createObjectURL(blob);
      previewUrlRef.current = url;
      setPreviewUrl(url);
      setPhase('preview');
    };
    recorderRef.current = recorder;
    startedAtRef.current = Date.now();
    setElapsed(0);
    recorder.start(1000);
    setPhase('recording');
    tickRef.current = window.setInterval(() => {
      setElapsed(Math.min(maxSeconds, Math.floor((Date.now() - startedAtRef.current) / 1000)));
    }, 250);
    limitRef.current = window.setTimeout(stopRecording, maxSeconds * 1000);
  }, [maxSeconds, releaseCamera, stopRecording]);

  const cancelCamera = useCallback(() => {
    releaseCamera();
    setPhase('idle');
  }, [releaseCamera]);

  const accept = useCallback(() => {
    const recording = recordingRef.current;
    if (!recording) return;
    revokePreview();
    recordingRef.current = null;
    setPhase('idle');
    onAccept(recording);
  }, [onAccept, revokePreview]);

  const remaining = maxSeconds - elapsed;

  return (
    <div className="video-recorder">
      {phase === 'idle' && (
        <div className="recorder-idle">
          <span className="status-icon status-icon-brand" aria-hidden="true">
            <Icon name="video" size={24} />
          </span>
          <button type="button" className="button-primary" onClick={() => void openCamera()}>
            {startLabel}
          </button>
        </div>
      )}

      {phase === 'requesting' && (
        <p role="status" className="loading-state">
          <span className="spinner" aria-hidden="true" />
          Waiting for camera and microphone permission…
        </p>
      )}

      {(phase === 'live' || phase === 'recording') && (
        <>
          <div className={phase === 'recording' ? 'video-stage is-recording' : 'video-stage'}>
            <video ref={liveVideoRef} className="video-frame" autoPlay muted playsInline aria-label="Camera preview" />
            {phase === 'recording' && (
              <span className="recording-indicator" role="timer" aria-live="off">
                Recording {formatDuration(elapsed)} / {formatDuration(maxSeconds)}
              </span>
            )}
          </div>
          {phase === 'live' ? (
            <div className="video-controls">
              <button type="button" className="button-primary" onClick={startRecording}>
                Start recording
              </button>
              <button type="button" className="button-secondary" onClick={cancelCamera}>
                Cancel
              </button>
              <span className="field-hint">Maximum {formatDuration(maxSeconds)}.</span>
            </div>
          ) : (
            <div className="video-controls">
              <button type="button" className="button-danger" onClick={stopRecording}>
                Stop recording
              </button>
              {remaining <= 10 && <span className="field-error">Recording stops in {remaining}s</span>}
            </div>
          )}
        </>
      )}

      {phase === 'preview' && previewUrl && (
        <>
          <video className="video-frame" src={previewUrl} controls playsInline aria-label="Recorded video preview" />
          <p className="field-hint">Watch your recording. Accept it to upload, or record it again.</p>
          <div className="video-controls">
            <button type="button" className="button-primary" onClick={accept}>
              Accept video
            </button>
            <button type="button" className="button-secondary" onClick={() => void openCamera()}>
              Re-record
            </button>
          </div>
        </>
      )}

      {phase === 'error' && error && (
        <>
          <p className="form-error" role="alert">
            {error}
          </p>
          {errorDetail && <p className="field-hint">Technical details: {errorDetail}</p>}
          <button type="button" className="button-secondary" onClick={() => void openCamera()}>
            Try again
          </button>
        </>
      )}
    </div>
  );
}
