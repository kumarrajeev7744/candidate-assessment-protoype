import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ApiError } from '../services/apiClient';
import { getSharedResponse } from '../services/reportService';
import type { SharedResponse } from '../types/report';
import { formatDateTime } from '../utils/format';
import { RefreshingVideo } from '../components/report/RefreshingVideo';
import { Icon } from '../components/ui/Icon';

type View =
  | { kind: 'loading' }
  | { kind: 'ready'; data: SharedResponse }
  | { kind: 'invalid' }
  | { kind: 'expired' }
  | { kind: 'error'; message: string };

/** Public, read-only page for a hiring manager: exactly one shared question and its response. */
export function SharedResponsePage() {
  const { token = '' } = useParams();
  const [view, setView] = useState<View>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    getSharedResponse(token)
      .then((data) => !cancelled && setView({ kind: 'ready', data }))
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) setView({ kind: 'invalid' });
        else if (err instanceof ApiError && err.status === 410) setView({ kind: 'expired' });
        else setView({ kind: 'error', message: err instanceof ApiError ? err.message : 'The response could not be loaded.' });
      });
    return () => {
      cancelled = true;
    };
  }, [token, attempt]);

  const refreshVideo = useCallback(async () => (await getSharedResponse(token)).response.video, [token]);

  return (
    <section className="page candidate-page shared-response">
      {view.kind === 'loading' && (
        <p role="status" className="loading-state">
          <span className="spinner" aria-hidden="true" />
          Loading shared response…
        </p>
      )}

      {view.kind === 'invalid' && (
        <div className="state-page">
          <span className="status-icon status-icon-danger">
            <Icon name="link" size={26} />
          </span>
          <h1>Link not valid</h1>
          <p>This link is invalid. Please check that you copied the full link from the email.</p>
        </div>
      )}

      {view.kind === 'expired' && (
        <div className="state-page">
          <span className="status-icon status-icon-warning">
            <Icon name="clock" size={26} />
          </span>
          <h1>Link expired</h1>
          <p>This link has expired. Shared links are valid for 7 days. Please ask the recruiter to share the response again.</p>
        </div>
      )}

      {view.kind === 'error' && (
        <>
          <h1>Something went wrong</h1>
          <p className="form-error" role="alert">
            {view.message}
          </p>
          <button
            type="button"
            className="button-primary"
            onClick={() => {
              setView({ kind: 'loading' });
              setAttempt((n) => n + 1);
            }}
          >
            Try again
          </button>
        </>
      )}

      {view.kind === 'ready' && (
        <>
          <div className="shared-banner">
            <span className="shared-pill">
              <Icon name="eye" size={14} /> Shared candidate response · read-only
            </span>
          </div>
          <span className="eyebrow">Candidate</span>
          <h1>{view.data.candidateName}</h1>
          <div className="shared-question">
            <span className="question-chip" aria-hidden="true">
              {view.data.question.number}
            </span>
            <div>
              <h2>Question {view.data.question.number}</h2>
              <p className="review-question">{view.data.question.text}</p>
            </div>
          </div>

          <h3 className="report-subheading">
            <Icon name="text" size={15} /> Written answer
          </h3>
          {view.data.response.writtenAnswer.trim() ? (
            <p className="answer-block">{view.data.response.writtenAnswer}</p>
          ) : (
            <p className="missing-block">No written answer</p>
          )}

          <h3 className="report-subheading">
            <Icon name="video" size={15} /> Video answer
          </h3>
          {view.data.response.video.available ? (
            <RefreshingVideo video={view.data.response.video} label="Video answer" onRefresh={refreshVideo} />
          ) : (
            <p className="missing-block">No video was recorded for this question.</p>
          )}

          <p className="field-hint shared-expiry">
            <Icon name="clock" size={14} /> This link expires on {formatDateTime(view.data.expiresAt)}.
          </p>
        </>
      )}
    </section>
  );
}
