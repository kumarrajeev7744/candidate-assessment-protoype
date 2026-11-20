import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError } from '../services/apiClient';
import { getCandidateReport } from '../services/reportService';
import type { CandidateReport, ReportQuestion } from '../types/report';
import { formatShortDateTime } from '../utils/format';
import { RefreshingVideo } from '../components/report/RefreshingVideo';
import { ShareResponseDialog, type ShareTarget } from '../components/report/ShareResponseDialog';
import { Icon } from '../components/ui/Icon';

const STATUS_CLASS: Record<string, string> = {
  Invited: 'badge badge-neutral',
  'In Progress': 'badge badge-info',
  Completed: 'badge badge-success',
};
const QUESTION_CLASS: Record<ReportQuestion['status'], string> = {
  Complete: 'badge badge-success',
  Incomplete: 'badge badge-warning',
  'Not Started': 'badge badge-neutral',
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts.at(-1)?.[0] ?? '') : '')).toUpperCase();
}

function videoStatusText(q: ReportQuestion): string {
  const status = q.response?.video.status ?? 'Missing';
  if (status === 'Missing') return 'No video recorded';
  if (status === 'Pending') return 'Video upload was not completed';
  if (status === 'Failed') return 'Video upload failed';
  return '';
}

/** Recruiter report: candidate details and all 10 questions with written and video responses. */
export function CandidateReportPage() {
  const { candidateId = '' } = useParams();
  const [report, setReport] = useState<CandidateReport | null>(null);
  const [error, setError] = useState<{ message: string; notFound: boolean } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [shareTarget, setShareTarget] = useState<ShareTarget | null>(null);
  const reportRef = useRef<CandidateReport | null>(null);

  useEffect(() => {
    let cancelled = false;
    getCandidateReport(candidateId)
      .then((data) => {
        if (cancelled) return;
        reportRef.current = data;
        setReport(data);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled || (err instanceof ApiError && err.status === 401)) return; // 401 → login (handled globally)
        const notFound = err instanceof ApiError && (err.status === 404 || err.status === 400);
        setError({
          notFound,
          message: notFound
            ? 'This candidate could not be found.'
            : err instanceof ApiError
              ? err.message
              : 'The report could not be loaded.',
        });
      });
    return () => {
      cancelled = true;
    };
  }, [candidateId, attempt]);

  const retry = () => {
    setError(null);
    setReport(null);
    setAttempt((n) => n + 1);
  };

  /** Fetches fresh presigned URLs (they expire after a few minutes) without resetting the page. */
  const refreshVideo = useCallback(
    async (questionId: string) => {
      const fresh = await getCandidateReport(candidateId);
      reportRef.current = fresh;
      return fresh.questions.find((q) => q.questionId === questionId)?.response?.video ?? null;
    },
    [candidateId],
  );

  const back = (
    <p className="back-link">
      <Link to="/admin/dashboard">← Back to candidates</Link>
    </p>
  );

  if (error) {
    return (
      <section className="page state-page">
        {back}
        <span className={error.notFound ? 'status-icon status-icon-brand' : 'status-icon status-icon-danger'}>
          <Icon name="alert" size={26} />
        </span>
        <h1>{error.notFound ? 'Candidate not found' : 'Could not load the report'}</h1>
        <p className="form-error" role="alert">
          {error.message}
        </p>
        {!error.notFound && (
          <button type="button" className="button-primary" onClick={retry}>
            Try again
          </button>
        )}
      </section>
    );
  }

  if (!report) {
    return (
      <section className="page page-plain report">
        {back}
        <p role="status" className="loading-state">
          <span className="spinner" aria-hidden="true" />
          Loading report…
        </p>
      </section>
    );
  }

  const { candidate, assessment, questions, summary } = report;
  return (
    <section className="page page-plain report">
      {back}
      <div className="card profile-card">
      <div className="report-header">
        <span className="avatar avatar-lg" aria-hidden="true">
          {initials(candidate.name)}
        </span>
        <div className="report-identity">
          <span className="eyebrow">Candidate report</span>
          <div className="report-title-row">
            <h1>{candidate.name}</h1>
            <span className={STATUS_CLASS[assessment.status]}>{assessment.status}</span>
            {assessment.isExpired && <span className="badge badge-danger">Expired</span>}
          </div>
        </div>
        {assessment.status === 'Completed' && (
          <button
            type="button"
            className="button-primary report-share-all"
            onClick={() => setShareTarget({ kind: 'report', questionCount: questions.length })}
          >
            <Icon name="share" size={16} />
            Share full report
          </button>
        )}
      </div>
      <div className="report-summary">
        <div className="progress-bar" aria-hidden="true">
          <div
            className="progress-fill"
            style={{ width: `${Math.round((summary.completedQuestions / Math.max(1, summary.totalQuestions)) * 100)}%` }}
          />
        </div>
      </div>
      <dl className="details report-details">
        <div>
          <dt>Email</dt>
          <dd>{candidate.email}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{assessment.status}</dd>
        </div>
        <div>
          <dt>Invitation date</dt>
          <dd>{formatShortDateTime(assessment.invitedAt)}</dd>
        </div>
        <div>
          <dt>Completion date</dt>
          <dd>{assessment.completedAt ? formatShortDateTime(assessment.completedAt) : 'Not completed'}</dd>
        </div>
        <div>
          <dt>Expiry date</dt>
          <dd>{formatShortDateTime(assessment.expiresAt)}</dd>
        </div>
        <div>
          <dt>Questions complete</dt>
          <dd>
            {summary.completedQuestions} of {summary.totalQuestions}
          </dd>
        </div>
      </dl>
      {assessment.status !== 'Completed' && (
        <p className="notice">This assessment has not been submitted yet. Responses can be shared once it is completed.</p>
      )}
      </div>

      <ol className="report-list">
        {questions.map((q) => {
          const missingVideo = videoStatusText(q);
          return (
            <li key={q.questionId} className="report-item" aria-label={`Question ${q.questionNumber}`}>
              <div className="report-item-header">
                <span className="question-chip" aria-hidden="true">
                  {q.questionNumber}
                </span>
                <h2>Question {q.questionNumber}</h2>
                <div className="row-actions report-item-actions">
                  <span className={QUESTION_CLASS[q.status]}>{q.status}</span>
                  {q.canShare && q.response && (
                    <button
                      type="button"
                      className="button-primary button-small"
                      onClick={() =>
                        q.response && setShareTarget({ kind: 'response', responseId: q.response.id, questionNumber: q.questionNumber })
                      }
                      aria-label={`Share question ${q.questionNumber}`}
                    >
                      <Icon name="share" size={15} />
                      Share
                    </button>
                  )}
                </div>
              </div>
              <p className="review-question">{q.questionText}</p>

              <h3 className="report-subheading">
                <Icon name="text" size={15} /> Written answer
              </h3>
              {q.response?.hasWrittenAnswer ? (
                <p className="answer-block">{q.response.writtenAnswer}</p>
              ) : (
                <p className="missing-block">No written answer</p>
              )}

              <h3 className="report-subheading">
                <Icon name="video" size={15} /> Video answer
              </h3>
              {q.response?.video.available ? (
                <RefreshingVideo
                  video={q.response.video}
                  label={`Video answer to question ${q.questionNumber}`}
                  onRefresh={() => refreshVideo(q.questionId)}
                />
              ) : (
                <p className="missing-block">{missingVideo}</p>
              )}
            </li>
          );
        })}
      </ol>

      {shareTarget && (
        <ShareResponseDialog
          candidateId={candidate.id}
          candidateName={candidate.name}
          target={shareTarget}
          onClose={() => setShareTarget(null)}
        />
      )}
    </section>
  );
}
