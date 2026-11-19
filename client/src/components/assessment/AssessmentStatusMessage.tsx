import type { FatalKind } from '../../context/AssessmentContext';

const CONTENT: Record<FatalKind, { title: string; body: string }> = {
  invalid: {
    title: 'Invitation not found',
    body: 'This assessment link is invalid. Please check that you copied the full link from your email. If you received a newer invitation email, please use the link in that email.',
  },
  expired: {
    title: 'Invitation expired',
    body: 'This invitation has expired. Please contact the recruiter to request a new link.',
  },
  completed: {
    title: 'Assessment already submitted',
    body: 'You have already completed this assessment. Thank you!',
  },
  unavailable: {
    title: 'Assessment unavailable',
    body: 'The assessment is not available right now. Please try again later.',
  },
};

export function AssessmentStatusMessage({ reason }: { reason: FatalKind }) {
  const { title, body } = CONTENT[reason];
  return (
    <section className="page candidate-page">
      <h1>{title}</h1>
      <p>{body}</p>
    </section>
  );
}
