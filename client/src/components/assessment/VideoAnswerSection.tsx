import { useCallback, useEffect, useState } from 'react';
import { useAssessment } from '../../context/AssessmentContext';
import { useVideoUpload } from '../../hooks/useVideoUpload';
import type { AssessmentQuestion, SavedResponse } from '../../types/assessment';
import type { AcceptedRecording } from '../../types/video';
import { formatDuration } from '../../utils/media';
import { VideoPlayer } from './VideoPlayer';
import { VideoRecorder } from './VideoRecorder';
import { Icon } from '../ui/Icon';

interface Props {
  question: AssessmentQuestion;
  /** True while an accepted video is uploading or awaiting retry: the page blocks navigation. */
  onBusyChange: (busy: boolean) => void;
}

/** Video part of a question: record → preview → accept → upload to S3 (with retries) → uploaded. */
export function VideoAnswerSection({ question, onBusyChange }: Props) {
  const { token, data, applySavedResponse, handleFatalError } = useAssessment();
  const maxSeconds = data?.assessment.videoMaxSeconds ?? 120;
  const uploaded = question.response?.videoStatus === 'Uploaded';
  const [rerecording, setRerecording] = useState(false);

  const onUploaded = useCallback(
    (response: SavedResponse) => {
      applySavedResponse(response);
      setRerecording(false);
    },
    [applySavedResponse],
  );
  const { state, upload, retry, reset, maxAttempts } = useVideoUpload({
    token,
    questionId: question.id,
    onUploaded,
    onFatalError: handleFatalError,
  });

  const uploading = state.phase === 'uploading' || state.phase === 'confirming' || state.phase === 'waiting-retry';
  const failed = state.phase === 'failed';

  useEffect(() => {
    onBusyChange(uploading || failed);
  }, [uploading, failed, onBusyChange]);

  // Warn before closing the page while an accepted video has not been stored yet.
  useEffect(() => {
    if (!uploading && !failed) return;
    const handler = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [uploading, failed]);

  const handleAccept = useCallback((recording: AcceptedRecording) => void upload(recording), [upload]);

  const discardAndRerecord = () => {
    reset();
    setRerecording(true);
  };

  const showRecorder = !uploading && !failed && (!uploaded || rerecording);

  return (
    <section className="video-section" aria-labelledby={`video-heading-${question.id}`}>
      <div className="video-section-header">
        <h2 id={`video-heading-${question.id}`}>
          <Icon name="video" size={18} /> Your video answer
        </h2>
        <span className={uploaded ? 'badge badge-success' : 'badge badge-neutral'} data-testid="video-status">
          {uploaded ? 'Video uploaded' : 'No video yet'}
        </span>
      </div>
      <p className="field-hint">Record a video of up to {formatDuration(maxSeconds)} (2 minutes).</p>

      {uploaded && !rerecording && !uploading && !failed && (
        <div className="video-uploaded">
          <VideoPlayer key={question.response?.updatedAt} token={token} questionId={question.id} />
          <button type="button" className="button-secondary button-small" onClick={() => setRerecording(true)}>
            Re-record video
          </button>
        </div>
      )}

      {showRecorder && (
        <>
          <VideoRecorder
            maxSeconds={maxSeconds}
            onAccept={handleAccept}
            startLabel={uploaded ? 'Record a new video' : 'Record video'}
          />
          {rerecording && uploaded && (
            <button type="button" className="button-link-plain" onClick={() => setRerecording(false)}>
              Keep my current video
            </button>
          )}
        </>
      )}

      {uploading && (
        <div className="upload-status" role="status" aria-live="polite">
          {state.phase === 'waiting-retry' ? (
            <p className="field-error">
              Upload attempt {state.attempt} of {maxAttempts} failed. Retrying ({state.attempt} of {maxAttempts - 1}{' '}
              retries)…
            </p>
          ) : (
            <p>
              {state.phase === 'confirming' ? 'Finishing upload…' : `Uploading video… ${Math.round(state.progress * 100)}%`}
              {state.attempt > 1 && ` (attempt ${state.attempt} of ${maxAttempts})`}
            </p>
          )}
          <progress max={100} value={Math.round(state.progress * 100)} aria-label="Upload progress" />
          <p className="field-hint">Please keep this page open until the upload finishes.</p>
        </div>
      )}

      {failed && (
        <div className="upload-status">
          <p className="form-error" role="alert">
            {state.error}
          </p>
          <p className="field-hint">Your recording is kept on this page; you do not need to record it again.</p>
          <div className="video-controls">
            <button type="button" className="button-primary" onClick={() => void retry()}>
              Try upload again
            </button>
            <button type="button" className="button-secondary" onClick={discardAndRerecord}>
              Discard and re-record
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
