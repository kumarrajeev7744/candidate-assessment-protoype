import { Navigate } from 'react-router-dom';
import { useAssessment } from '../../context/AssessmentContext';
import { formatDateTime } from '../../utils/format';
import { Icon } from '../../components/ui/Icon';

/** Final screen after a successful submission. Deliberately has no links back into the assessment. */
export function SubmittedPage() {
  const { data, submission } = useAssessment();
  if (!data) return null;
  if (!submission) return <Navigate to=".." relative="path" replace />;

  return (
    <section className="page candidate-page state-page submitted-page">
      <span className="status-icon status-icon-success">
        <Icon name="checkCircle" size={30} />
      </span>
      <h1>Assessment submitted successfully.</h1>
      <dl className="details">
        <div>
          <dt>Name</dt>
          <dd>{data.candidate.name}</dd>
        </div>
        <div>
          <dt>Submitted</dt>
          <dd>{formatDateTime(submission.completedAt)}</dd>
        </div>
      </dl>
      {submission.confirmationEmailSent ? (
        <p className="success" role="status">
          A confirmation email has been sent to {data.candidate.email}.
        </p>
      ) : (
        <p className="notice" role="status">
          Your assessment was submitted successfully, but we could not send the confirmation email. You do not need to
          do anything else.
        </p>
      )}
      <p>Thank you for completing the assessment. You can now close this page.</p>
    </section>
  );
}
