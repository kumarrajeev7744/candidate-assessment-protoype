import { Outlet, useParams } from 'react-router-dom';
import { AssessmentProvider, useAssessment } from '../../context/AssessmentContext';
import { AssessmentStatusMessage } from '../../components/assessment/AssessmentStatusMessage';

function AssessmentGate() {
  const { load, reload } = useAssessment();

  if (load.kind === 'loading') {
    return (
      <section className="page candidate-page">
        <p role="status">Loading your assessment…</p>
      </section>
    );
  }
  if (load.kind === 'fatal') return <AssessmentStatusMessage reason={load.reason} />;
  if (load.kind === 'error') {
    return (
      <section className="page candidate-page">
        <h1>Something went wrong</h1>
        <p className="form-error" role="alert">
          {load.message}
        </p>
        <button type="button" className="button-primary" onClick={reload}>
          Try again
        </button>
      </section>
    );
  }
  return <Outlet />;
}

/** Candidate assessment area (/assessment/:token/*). Independent of recruiter authentication. */
export function AssessmentLayout() {
  const { token = '' } = useParams();
  return (
    <AssessmentProvider key={token} token={token}>
      <AssessmentGate />
    </AssessmentProvider>
  );
}
