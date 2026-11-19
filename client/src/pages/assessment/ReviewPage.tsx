import { useEffect } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useAssessment } from '../../context/AssessmentContext';
import { ProgressIndicator } from '../../components/assessment/ProgressIndicator';
import { VideoPlayer } from '../../components/assessment/VideoPlayer';
import { storePosition } from '../../utils/assessmentPosition';

export function ReviewPage() {
  const { token, data, drafts, saveStatus, completedCount, isQuestionComplete } = useAssessment();

  useEffect(() => {
    storePosition(token, 'review');
  }, [token]);

  if (!data) return null;
  if (data.assessment.status !== 'In Progress') return <Navigate to=".." relative="path" replace />;

  const total = data.questions.length;
  const incomplete = total - completedCount;

  return (
    <section className="page candidate-page">
      <h1>Review your answers</h1>
      <ProgressIndicator completed={completedCount} total={total} />
      {incomplete > 0 ? (
        <p className="notice" role="status">
          {incomplete} {incomplete === 1 ? 'question still needs' : 'questions still need'} a written answer and a
          video.
        </p>
      ) : (
        <p className="success" role="status">
          All {total} questions have a saved written answer and video.
        </p>
      )}

      <ol className="review-list">
        {data.questions.map((q) => {
          const answer = (drafts[q.id] ?? '').trim();
          const unsaved = ['unsaved', 'saving', 'error'].includes(saveStatus[q.id] ?? 'idle');
          const videoUploaded = q.response?.videoStatus === 'Uploaded';
          return (
            <li key={q.id} className="review-item" aria-label={`Question ${q.questionNumber}`}>
              <div className="review-item-header">
                <h2>Question {q.questionNumber}</h2>
                <span className={isQuestionComplete(q) ? 'badge badge-success' : 'badge'}>
                  {isQuestionComplete(q) ? 'Complete' : 'Incomplete'}
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

      <p className="field-hint">Final submission will be available in the next stage. Your answers and videos are saved.</p>
      <Link to={`../questions/${total}`} relative="path" className="button-secondary">
        Back to question {total}
      </Link>
    </section>
  );
}
