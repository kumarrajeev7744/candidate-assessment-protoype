import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAssessment } from '../../context/AssessmentContext';
import { ApiError } from '../../services/apiClient';
import { formatDateTime } from '../../utils/format';
import { resumePath } from './resumePosition';

export function AssessmentStartPage() {
  const { token, data, firstIncompleteNumber, start, reload, submission } = useAssessment();
  const navigate = useNavigate();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!data) return null;
  if (submission) return <Navigate to="submitted" replace />;
  const { candidate, assessment } = data;

  // Returning candidate: continue where they left off.
  if (assessment.status === 'In Progress' && !starting) {
    return <Navigate to={resumePath(token, firstIncompleteNumber)} replace />;
  }

  async function handleStart() {
    setStarting(true);
    setError(null);
    try {
      await start();
      navigate('questions/1', { replace: true });
    } catch (err) {
      setStarting(false);
      if (err instanceof ApiError && [401, 409, 410].includes(err.status)) {
        reload(); // show the invalid/expired/submitted message
        return;
      }
      setError(err instanceof ApiError ? err.message : 'Could not start the assessment. Please try again.');
    }
  }

  const videoMinutes = Math.round(assessment.videoMaxSeconds / 60);

  return (
    <section className="page candidate-page">
      <h1>Welcome, {candidate.name}</h1>
      <dl className="details">
        <div>
          <dt>Name</dt>
          <dd>{candidate.name}</dd>
        </div>
        <div>
          <dt>Email</dt>
          <dd>{candidate.email}</dd>
        </div>
        <div>
          <dt>Link expires</dt>
          <dd>{formatDateTime(assessment.expiresAt)}</dd>
        </div>
      </dl>

      <h2>Before you begin</h2>
      <ul className="instructions">
        <li>
          The assessment has <strong>{assessment.totalQuestions} questions</strong>, shown one at a time in a fixed
          order.
        </li>
        <li>
          Each question needs a <strong>written answer</strong> (up to{' '}
          {assessment.writtenAnswerMaxLength.toLocaleString('en-US')} characters) and a{' '}
          <strong>video answer</strong> (up to {videoMinutes} minutes).
        </li>
        <li>Your written answers are saved automatically as you type.</li>
        <li>
          For each video, you can watch your recording and record it again before accepting it. Accepted videos are
          uploaded straight away.
        </li>
        <li>You can move to the next question once both the written answer and the video are saved.</li>
        <li>You can go back to earlier questions and edit your answers before submitting.</li>
        <li>If you close the page, reopen the link from your email to continue where you left off.</li>
        <li>
          Use a computer with a camera and microphone, a modern browser and a stable internet connection. Your browser
          will ask for permission to use them.
        </li>
      </ul>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <button type="button" className="button-primary" onClick={handleStart} disabled={starting}>
        {starting ? 'Starting…' : 'Start Assessment'}
      </button>
    </section>
  );
}
