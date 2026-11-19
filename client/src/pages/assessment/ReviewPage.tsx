import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { UnsavedChangesError, useAssessment } from '../../context/AssessmentContext';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { ProgressIndicator } from '../../components/assessment/ProgressIndicator';
import { VideoPlayer } from '../../components/assessment/VideoPlayer';
import { ApiError } from '../../services/apiClient';
import type { AssessmentQuestion, MissingResponse } from '../../types/assessment';
import { storePosition } from '../../utils/assessmentPosition';

function describeSubmitError(err: unknown): string {
  if (err instanceof UnsavedChangesError) return err.message;
  if (err instanceof ApiError) {
    if (err.code === 'ASSESSMENT_INCOMPLETE') {
      const missing = (err.details as { missing?: MissingResponse[] } | undefined)?.missing ?? [];
      const parts = missing.map((m) => {
        const what = [m.writtenMissing && 'written answer', m.videoMissing && 'video'].filter(Boolean).join(' and ');
        return `Question ${m.questionNumber} (${what} missing)`;
      });
      return parts.length ? `Your assessment is not complete yet: ${parts.join('; ')}.` : err.message;
    }
    if (err.status === 0) return err.message;
    if (err.status >= 500) return 'Something went wrong while submitting. Your answers are saved; please try again.';
    return err.message;
  }
  return 'Something went wrong while submitting. Please try again.';
}

export function ReviewPage() {
  const { token, data, drafts, saveStatus, completedCount, isQuestionComplete, submit, submission, handleFatalError } =
    useAssessment();
  const navigate = useNavigate();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    storePosition(token, 'review');
  }, [token]);

  const closeDialog = useCallback(() => {
    setDialogOpen(false);
    setSubmitError(null);
  }, []);

  if (!data) return null;
  if (submission) return <Navigate to="../submitted" relative="path" replace />;
  if (data.assessment.status !== 'In Progress') return <Navigate to=".." relative="path" replace />;

  const total = data.questions.length;
  const incomplete = total - completedCount;
  const canSubmit = incomplete === 0;
  const needsAttention = data.questions.filter((q) => !isQuestionComplete(q));

  const issues = (q: AssessmentQuestion) =>
    [
      !(drafts[q.id] ?? '').trim() && 'Written answer missing',
      q.response?.videoStatus !== 'Uploaded' && 'Video missing',
    ].filter(Boolean) as string[];

  async function handleSubmit() {
    setSubmitting(true);
    setSubmitError(null);
    try {
      await submit();
      navigate('../submitted', { relative: 'path', replace: true });
    } catch (err) {
      setSubmitting(false);
      if (handleFatalError(err)) return; // expired / already submitted / invalid link screen
      setSubmitError(describeSubmitError(err));
    }
  }

  return (
    <section className="page candidate-page">
      <h1>Review your answers</h1>
      <ProgressIndicator completed={completedCount} total={total} />
      <p className="review-summary">
        <strong>{completedCount}</strong> completed · <strong>{incomplete}</strong> incomplete
      </p>

      {canSubmit ? (
        <p className="success" role="status">
          All {total} questions have a saved written answer and video. You can submit your assessment.
        </p>
      ) : (
        <div className="notice" role="status">
          <p>Complete all {total} questions before submitting. Questions needing attention:</p>
          <ul className="attention-list">
            {needsAttention.map((q) => (
              <li key={q.id}>
                <Link to={`../questions/${q.questionNumber}`} relative="path">
                  Question {q.questionNumber}
                </Link>{' '}
                – {issues(q).join(', ')}
              </li>
            ))}
          </ul>
        </div>
      )}

      {submitError && !dialogOpen && (
        <p className="form-error" role="alert">
          {submitError}
        </p>
      )}

      <ol className="review-list">
        {data.questions.map((q) => {
          const answer = (drafts[q.id] ?? '').trim();
          const unsaved = ['unsaved', 'saving', 'error'].includes(saveStatus[q.id] ?? 'idle');
          const videoUploaded = q.response?.videoStatus === 'Uploaded';
          const complete = isQuestionComplete(q);
          return (
            <li key={q.id} className="review-item" aria-label={`Question ${q.questionNumber}`}>
              <div className="review-item-header">
                <h2>Question {q.questionNumber}</h2>
                <span className={complete ? 'badge badge-success' : 'badge badge-warning'}>
                  {complete ? 'Complete' : 'Incomplete'}
                </span>
              </div>
              <p className="review-question">{q.questionText}</p>
              {answer ? (
                <p className="review-answer">{answer}</p>
              ) : (
                <p className="review-missing">No written answer yet</p>
              )}
              {unsaved && <p className="field-error">This answer has unsaved changes.</p>}
              <div className="review-video">
                <span data-testid={`review-video-status-${q.questionNumber}`}>
                  Video: <strong>{videoUploaded ? 'Uploaded' : 'Not recorded'}</strong>
                </span>
                {videoUploaded && <VideoPlayer key={q.response?.updatedAt} token={token} questionId={q.id} />}
              </div>
              <Link
                to={`../questions/${q.questionNumber}`}
                relative="path"
                className="button-secondary button-small"
                aria-label={`Edit question ${q.questionNumber}`}
              >
                Edit
              </Link>
            </li>
          );
        })}
      </ol>

      <div className="question-nav">
        <Link to={`../questions/${total}`} relative="path" className="button-secondary">
          Back to question {total}
        </Link>
        <button
          type="button"
          className="button-primary"
          disabled={!canSubmit || submitting}
          onClick={() => {
            setSubmitError(null);
            setDialogOpen(true);
          }}
        >
          Submit Assessment
        </button>
      </div>

      {dialogOpen && (
        <ConfirmDialog
          title="Submit your assessment?"
          confirmLabel="Submit assessment"
          busyLabel="Submitting…"
          busy={submitting}
          error={submitError}
          onConfirm={() => void handleSubmit()}
          onCancel={closeDialog}
        >
          <p>Submission is final. After you submit, you will not be able to edit your written answers or re-record your videos.</p>
        </ConfirmDialog>
      )}
    </section>
  );
}
