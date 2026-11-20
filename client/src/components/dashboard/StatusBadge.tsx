import type { CandidateListItem } from '../../types/recruiter';

const CLASS: Record<CandidateListItem['status'], string> = {
  Invited: 'badge badge-neutral',
  'In Progress': 'badge badge-info',
  Completed: 'badge badge-success',
};

export function StatusBadge({ item }: { item: CandidateListItem }) {
  return (
    <div className="status-cell">
      <span className={CLASS[item.status]}>{item.status}</span>
      {item.rejection && <span className="badge badge-danger">Rejected</span>}
      {item.isExpired && !item.rejection && <span className="badge badge-danger">Expired</span>}
      {item.status !== 'Completed' && item.emailStatus === 'Failed' && (
        <span className="status-note">Invitation email failed</span>
      )}
      {item.status === 'Completed' && item.confirmationEmailStatus === 'Failed' && (
        <span className="status-note">Confirmation email failed</span>
      )}
    </div>
  );
}
