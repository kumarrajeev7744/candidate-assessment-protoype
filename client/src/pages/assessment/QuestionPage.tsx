import { useCallback, useEffect, useId, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { useAssessment } from '../../context/AssessmentContext';
import { ProgressIndicator } from '../../components/assessment/ProgressIndicator';
import { SaveIndicator } from '../../components/assessment/SaveIndicator';
import { VideoAnswerSection } from '../../components/assessment/VideoAnswerSection';
import { storePosition } from '../../utils/assessmentPosition';

export function QuestionPage() {
  const {
    token,
    data,
    drafts,
    saveStatus,
    saveError,
    completedCount,
    firstIncompleteNumber,
    updateDraft,
    saveNow,
  } = useAssessment();
  const navigate = useNavigate();
  const params = useParams();
  const textareaId = useId();
  const [navigating, setNavigating] = useState(false);
  const [videoBusy, setVideoBusy] = useState(false);
  // Which requirement blocked "Next", tagged with the question number so it never carries over.
  const [blocked, setBlocked] = useState<{ number: number; reason: 'written' | 'video' } | null>(null);
  const onBusyChange = useCallback((busy: boolean) => setVideoBusy(busy), []);

  const total = data?.questions.length ?? 0;
  const number = Number(params.number);
  const inRange = Number.isInteger(number) && number >= 1 && number <= total;
  // Questions are answered in order: later questions open only after earlier ones are complete.
  const reachable = inRange && (firstIncompleteNumber === null || number <= firstIncompleteNumber);

  useEffect(() => {
    if (reachable) storePosition(token, number);
  }, [token, number, reachable]);

  if (!data) return null;
  if (data.assessment.status !== 'In Progress') return <Navigate to="../.." relative="path" replace />;
  if (!reachable) return <Navigate to={`../${firstIncompleteNumber ?? 1}`} relative="path" replace />;

  const question = data.questions[number - 1]!;
  const text = drafts[question.id] ?? '';
  const max = data.assessment.writtenAnswerMaxLength;
  const status = saveStatus[question.id] ?? 'idle';
  const videoUploaded = question.response?.videoStatus === 'Uploaded';
  const isLast = number === total;
  // The message disappears as soon as the missing part is provided.
  const navError =
    blocked?.number !== number
      ? null
      : blocked.reason === 'written' && !text.trim()
        ? 'Please write your answer before continuing.'
        : blocked.reason === 'video' && !videoUploaded
          ? 'Please record and upload your video answer before continuing.'
          : null;

  async function goPrevious() {
    setBlocked(null);
    setNavigating(true);
    const ok = await saveNow(question.id);
    setNavigating(false);
    if (ok) navigate(`../${number - 1}`, { relative: 'path' });
  }

  async function goNext() {
    setBlocked(null);
    setNavigating(true);
    const ok = await saveNow(question.id);
    setNavigating(false);
    if (!ok) return;
    if (!text.trim()) {
      setBlocked({ number, reason: 'written' });
      return;
    }
    if (!videoUploaded) {
      setBlocked({ number, reason: 'video' });
      return;
    }
    navigate(isLast ? '../../review' : `../${number + 1}`, { relative: 'path' });
  }

  return (
    <section className="page candidate-page question-page">
      <div className="question-header">
        <p className="question-count">
          Question {number} of {total}
        </p>
        <ProgressIndicator completed={completedCount} total={total} />
      </div>

      <h1 className="question-text">{question.questionText}</h1>

      <div className="field">
        <label htmlFor={textareaId}>Your written answer</label>
        <textarea
          id={textareaId}
          rows={8}
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
        {text.length >= max && (
          <p className="field-hint">You have reached the {max.toLocaleString('en-US')}-character limit.</p>
        )}
        {status === 'error' && saveError && (
          <p className="form-error" role="alert">
            {saveError}
          </p>
        )}
      </div>

      <VideoAnswerSection key={question.id} question={question} onBusyChange={onBusyChange} />

      {navError && (
        <p className="form-error" role="alert">
          {navError}
        </p>
      )}
      {videoBusy && <p className="field-hint">Please wait for the video upload to finish before leaving this question.</p>}

      <div className="question-nav">
        <button
          type="button"
          className="button-secondary"
          onClick={() => void goPrevious()}
          disabled={number === 1 || navigating || videoBusy}
        >
          Previous
        </button>
        <button type="button" className="button-primary" onClick={() => void goNext()} disabled={navigating || videoBusy}>
          {isLast ? 'Review answers' : 'Next'}
        </button>
      </div>
    </section>
  );
}
