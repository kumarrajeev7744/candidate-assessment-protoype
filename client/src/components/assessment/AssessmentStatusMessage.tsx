import type { FatalKind } from '../../context/AssessmentContext';
import { Icon, type IconName } from '../ui/Icon';

const ICON: Record<FatalKind, { name: IconName; tone: string }> = {
  invalid: { name: 'link', tone: 'status-icon-danger' },
  expired: { name: 'clock', tone: 'status-icon-warning' },
  completed: { name: 'checkCircle', tone: 'status-icon-success' },
  unavailable: { name: 'alert', tone: 'status-icon-warning' },
  closed: { name: 'lock', tone: 'status-icon-brand' },
};

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
  closed: {
    title: 'Assessment no longer available',
    body: 'This assessment is no longer available. If you have any questions, please contact the recruiter.',
  },
  unavailable: {
    title: 'Assessment unavailable',
    body: 'The assessment is not available right now. Please try again later.',
  },
};

export function AssessmentStatusMessage({ reason }: { reason: FatalKind }) {
  const { title, body } = CONTENT[reason];
  return (
    <section className="page candidate-page state-page">
      <span className={`status-icon ${ICON[reason].tone}`}>
        <Icon name={ICON[reason].name} size={28} />
      </span>
      <h1>{title}</h1>
      <p>{body}</p>
    </section>
  );
}
