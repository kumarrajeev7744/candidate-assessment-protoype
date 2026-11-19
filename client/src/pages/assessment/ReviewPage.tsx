import { useEffect } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useAssessment } from '../../context/AssessmentContext';
import { ProgressIndicator } from '../../components/assessment/ProgressIndicator';
import { storePosition } from '../../utils/assessmentPosition';

export function ReviewPage() {
  const { token, data, drafts, saveStatus, writtenAnsweredCount } = useAssessment();

  useEffect(() => {
    storePosition(token, 'review');
  }, [token]);

  if (!data) return null;
  if (data.assessment.status !== 'In Progress') return <Navigate to=".." relative="path" replace />;

  const total = data.questions.length;
  const missing = total - writtenAnsweredCount;

  return (
    <section className="page candidate-page">
      <h1>Review your answers</h1>
      <ProgressIndicator answered={writtenAnsweredCount} total={total} />
      {missing > 0 ? (
        <p className="notice" role="status">
          {missing} {missing === 1 ? 'question is' : 'questions are'} missing a written answer.
        </p>
      ) : (
        <p className="success" role="status">
          All {total} written answers are saved.
        </p>
      )}

      <ol className="review-list">
        {data.questions.map((q) => {
          const answer = (drafts[q.id] ?? '').trim();
          const unsaved = ['unsaved', 'saving', 'error'].includes(saveStatus[q.id] ?? 'idle');
          return (
            <li key={q.id} className="review-item" aria-label={`Question ${q.questionNumber}`}>
              <div className="review-item-header">
                <h2>Question {q.questionNumber}</h2>
                <Link
                  to={`../questions/${q.questionNumber}`}
                  relative="path"
                  className="button-secondary button-small"
                  aria-label={`Edit question ${q.questionNumber}`}
                >
                  Edit
                </Link>
              </div>
              <p className="review-question">{q.questionText}</p>
              {answer ? (
                <p className="review-answer">{answer}</p>
              ) : (
                <p className="review-missing">No written answer yet</p>
              )}
              {unsaved && <p className="field-error">This answer has unsaved changes.</p>}
            </li>
          );
        })}
      </ol>

      <p className="field-hint">
        Video answers and final submission will be available in the next stage. Your written answers are saved.
      </p>
      <Link to={`../questions/${total}`} relative="path" className="button-secondary">
        Back to question {total}
      </Link>
    </section>
  );
}
