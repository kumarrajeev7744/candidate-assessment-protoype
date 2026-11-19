import { useEffect, useId, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { useAssessment } from '../../context/AssessmentContext';
import { ProgressIndicator } from '../../components/assessment/ProgressIndicator';
import { SaveIndicator } from '../../components/assessment/SaveIndicator';
import { storePosition } from '../../utils/assessmentPosition';

export function QuestionPage() {
  const { token, data, drafts, saveStatus, saveError, writtenAnsweredCount, updateDraft, saveNow } = useAssessment();
  const navigate = useNavigate();
  const params = useParams();
  const textareaId = useId();
  const [navigating, setNavigating] = useState(false);

  const total = data?.questions.length ?? 0;
  const number = Number(params.number);
  const valid = Number.isInteger(number) && number >= 1 && number <= total;

  useEffect(() => {
    if (valid) storePosition(token, number);
  }, [token, number, valid]);

  if (!data) return null;
  if (data.assessment.status !== 'In Progress') return <Navigate to="../.." relative="path" replace />;
  if (!valid) return <Navigate to="../1" relative="path" replace />;

  const question = data.questions[number - 1]!;
  const text = drafts[question.id] ?? '';
  const max = data.assessment.writtenAnswerMaxLength;
  const status = saveStatus[question.id] ?? 'idle';

  async function go(target: string) {
    setNavigating(true);
    const ok = await saveNow(question.id);
    setNavigating(false);
    if (ok) navigate(target, { relative: 'path' });
  }

  const isLast = number === total;

  return (
    <section className="page candidate-page question-page">
      <div className="question-header">
        <p className="question-count">
          Question {number} of {total}
        </p>
        <ProgressIndicator answered={writtenAnsweredCount} total={total} />
      </div>

      <h1 className="question-text">{question.questionText}</h1>

      <div className="field">
        <label htmlFor={textareaId}>Your written answer</label>
        <textarea
          id={textareaId}
          rows={10}
          value={text}
          onChange={(e) => updateDraft(question.id, e.target.value)}
          aria-describedby={`${textareaId}-count`}
        />
        <div className="textarea-footer">
          <SaveIndicator status={status} onRetry={() => void saveNow(question.id)} />
          <span id={`${textareaId}-count`} className={text.length >= max ? 'char-count at-limit' : 'char-count'}>
            {text.length}/{max}
          </span>
        </div>
        {text.length >= max && <p className="field-hint">You have reached the {max.toLocaleString('en-US')}-character limit.</p>}
        {status === 'error' && saveError && (
          <p className="form-error" role="alert">
            {saveError}
          </p>
        )}
      </div>

      <p className="field-hint">Video recording for this question will be added in the next stage.</p>

      <div className="question-nav">
        <button
          type="button"
          className="button-secondary"
          onClick={() => void go(`../${number - 1}`)}
          disabled={number === 1 || navigating}
        >
          Previous
        </button>
        <button
          type="button"
          className="button-primary"
          onClick={() => void go(isLast ? '../../review' : `../${number + 1}`)}
          disabled={navigating}
        >
          {isLast ? 'Review answers' : 'Next'}
        </button>
      </div>
    </section>
  );
}
