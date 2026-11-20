import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { ApiError } from '../../services/apiClient';
import { rejectCandidate } from '../../services/recruiterService';
import type { Rejection } from '../../types/recruiter';

export const REJECTION_REASON_MAX = 500;

interface Props {
  candidateId: string;
  candidateName: string;
  candidateCompleted: boolean;
  onRejected: (rejection: Rejection) => void;
  onClose: () => void;
}

/** Asks for a rejection reason (required, max 500 characters) and records the rejection. */
export function RejectCandidateDialog({ candidateId, candidateName, candidateCompleted, onRejected, onClose }: Props) {
  const titleId = useId();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [reason, setReason] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    textareaRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [saving, onClose]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setError(null);
    const value = reason.trim();
    if (!value) return setFieldError('Please enter a reason for the rejection.');
    setFieldError(null);
    setSaving(true);
    try {
      const result = await rejectCandidate(candidateId, value);
      onRejected(result.rejection);
    } catch (err) {
      setSaving(false);
      if (err instanceof ApiError && err.code === 'VALIDATION_ERROR') {
        setFieldError('Please enter a reason of up to 500 characters.');
      } else {
        setError(err instanceof ApiError ? err.message : 'The candidate could not be rejected. Please try again.');
      }
    }
  }

  const remaining = REJECTION_REASON_MAX - reason.length;

  return (
    <div className="dialog-backdrop">
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <h2 id={titleId}>Reject {candidateName}?</h2>
        <p className="field-hint">
          The reason is recorded with the candidate and visible to recruiters only; the candidate is not emailed.
          {!candidateCompleted && ' Their assessment link will stop working.'} You can undo this later.
        </p>
        <form className="form" onSubmit={handleSubmit} noValidate>
          <div className="field">
            <label htmlFor={`${titleId}-reason`}>Reason for rejection</label>
            <textarea
              ref={textareaRef}
              id={`${titleId}-reason`}
              rows={5}
              value={reason}
              maxLength={REJECTION_REASON_MAX}
              onChange={(e) => {
                setReason(e.target.value.slice(0, REJECTION_REASON_MAX));
                if (fieldError) setFieldError(null);
              }}
              aria-invalid={Boolean(fieldError)}
              aria-describedby={`${titleId}-count${fieldError ? ` ${titleId}-error` : ''}`}
              disabled={saving}
              placeholder="e.g. Limited experience with enterprise accounts."
            />
            <div className="textarea-footer">
              {fieldError ? (
                <span id={`${titleId}-error`} className="field-error">
                  {fieldError}
                </span>
              ) : (
                <span />
              )}
              <span id={`${titleId}-count`} className={remaining === 0 ? 'char-count at-limit' : 'char-count'}>
                {reason.length}/{REJECTION_REASON_MAX}
              </span>
            </div>
          </div>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <button type="button" className="button-secondary" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button type="submit" className="button-danger" disabled={saving}>
              {saving ? 'Rejecting…' : 'Reject candidate'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
