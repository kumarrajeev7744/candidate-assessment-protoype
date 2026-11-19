export function ProgressIndicator({ completed, total }: { completed: number; total: number }) {
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
  return (
    <div className="progress">
      <div
        className="progress-bar"
        role="progressbar"
        aria-label="Questions completed"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={completed}
      >
        <div className="progress-fill" style={{ width: `${percent}%` }} />
      </div>
      <span className="progress-label">
        {completed} of {total} questions complete
      </span>
    </div>
  );
}
