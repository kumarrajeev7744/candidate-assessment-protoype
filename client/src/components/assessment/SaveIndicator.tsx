import type { SaveStatus } from '../../context/AssessmentContext';

const LABELS: Record<SaveStatus, string> = {
  idle: '',
  unsaved: 'Unsaved changes',
  saving: 'Saving…',
  saved: 'Saved',
  error: 'Save failed',
};

export function SaveIndicator({ status, onRetry }: { status: SaveStatus; onRetry: () => void }) {
  return (
    <div className={`save-indicator save-${status}`} aria-live="polite" data-testid="save-status">
      <span>{LABELS[status]}</span>
      {status === 'error' && (
        <button type="button" className="button-secondary button-small" onClick={onRetry}>
          Retry save
        </button>
      )}
    </div>
  );
}
