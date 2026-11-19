import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError } from '../services/apiClient';
import { getCandidateReport } from '../services/reportService';
import type { CandidateReport, ReportQuestion } from '../types/report';
import { formatShortDateTime } from '../utils/format';
import { RefreshingVideo } from '../components/report/RefreshingVideo';
import { ShareResponseDialog } from '../components/report/ShareResponseDialog';

const STATUS_CLASS: Record<string, string> = {
  Invited: 'badge',
  'In Progress': 'badge badge-info',
  Completed: 'badge badge-success',
};
const QUESTION_CLASS: Record<ReportQuestion['status'], string> = {
  Complete: 'badge badge-success',
  Incomplete: 'badge badge-warning',
  'Not Started': 'badge',
};

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
  const [shareTarget, setShareTarget] = useState<ReportQuestion | null>(null);
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
    <p>
      <Link to="/admin/dashboard">← Back to candidates</Link>
    </p>
  );

  if (error) {
    return (
      <section className="page">
        {back}
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
      <section className="page">
        {back}
        <p role="status">Loading report…</p>
      </section>
    );
  }

  const { candidate, assessment, questions, summary } = report;
  return (
    <section className="page report">
      {back}
      <div className="report-header">
        <h1>{candidate.name}</h1>
        <span className={STATUS_CLASS[assessment.status]}>{assessment.status}</span>
        {assessment.isExpired && <span className="badge badge-danger">Expired</span>}
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

      <ol className="report-list">
        {questions.map((q) => {
          const missingVideo = videoStatusText(q);
          return (
            <li key={q.questionId} className="report-item" aria-label={`Question ${q.questionNumber}`}>
              <div className="review-item-header">
                <h2>Question {q.questionNumber}</h2>
                <div className="row-actions">
                  <span className={QUESTION_CLASS[q.status]}>{q.status}</span>
                  {q.canShare && q.response && (
                    <button
                      type="button"
                      className="button-secondary button-small"
                      onClick={() => setShareTarget(q)}
                      aria-label={`Share question ${q.questionNumber}`}
                    >
                      Share
                    </button>
                  )}
                </div>
              </div>
              <p className="review-question">{q.questionText}</p>

              <h3 className="report-subheading">Written answer</h3>
              {q.response?.hasWrittenAnswer ? (
                <p className="review-answer">{q.response.writtenAnswer}</p>
              ) : (
                <p className="review-missing">No written answer</p>
              )}

              <h3 className="report-subheading">Video answer</h3>
              {q.response?.video.available ? (
                <RefreshingVideo
                  video={q.response.video}
                  label={`Video answer to question ${q.questionNumber}`}
                  onRefresh={() => refreshVideo(q.questionId)}
                />
              ) : (
                <p className="review-missing">{missingVideo}</p>
              )}
            </li>
          );
        })}
      </ol>

      {shareTarget?.response && (
        <ShareResponseDialog
          candidateId={candidate.id}
          candidateName={candidate.name}
          responseId={shareTarget.response.id}
          questionNumber={shareTarget.questionNumber}
          onClose={() => setShareTarget(null)}
        />
      )}
    </section>
  );
}
