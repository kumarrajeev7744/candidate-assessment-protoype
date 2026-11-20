import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { ApiError } from '../../services/apiClient';
import { shareFullReport, shareResponse } from '../../services/reportService';
import { isValidEmail } from '../../utils/validation';
import { formatDateTime } from '../../utils/format';
import type { ShareResult } from '../../types/report';

/** What to share: one question's response, or the candidate's full assessment. */
export type ShareTarget = { kind: 'response'; responseId: string; questionNumber: number } | { kind: 'report'; questionCount: number };

interface Props {
  candidateId: string;
  candidateName: string;
  target: ShareTarget;
  onClose: () => void;
}

/** Asks for a hiring manager's email and shares one response or the full report. Cancelling creates nothing. */
export function ShareResponseDialog({ candidateId, candidateName, target, onClose }: Props) {
  const titleId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [email, setEmail] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<ShareResult | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !sending) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sending, onClose]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending) return; // prevent duplicate submissions
    setError(null);
    const value = email.trim();
    if (!value) return setFieldError('Recipient email is required.');
    if (!isValidEmail(value) || value.length > 254) return setFieldError('Enter a valid email address.');
    setFieldError(null);

    setSending(true);
    try {
      setResult(
        target.kind === 'report'
          ? await shareFullReport(candidateId, value)
          : await shareResponse(target.responseId, { candidateId, recipientEmail: value }),
      );
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'VALIDATION_ERROR') setFieldError('Enter a valid email address.');
        else if (err.code === 'EMAIL_DELIVERY_FAILED') setError('The email could not be sent, so nothing was shared. Please try again.');
        else setError(err.status === 0 ? err.message : `Could not share the ${target.kind === 'report' ? 'report' : 'response'}. ${err.message}`);
      } else {
        setError('Could not share the response. Please try again.');
      }
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="dialog-backdrop">
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <h2 id={titleId}>{target.kind === 'report' ? 'Share full report' : `Share question ${target.questionNumber}`}</h2>
        {result ? (
          <>
            <p className="success" role="status">
              {target.kind === 'report' ? 'The full report was' : 'The response was'} shared with{' '}
              {result.shareLink.recipientEmail}. The link expires on{' '}
              {formatDateTime(result.shareLink.expiresAt)}.
            </p>
            <div className="dialog-actions">
              <button type="button" className="button-primary" onClick={onClose}>
                Done
              </button>
            </div>
          </>
        ) : (
          <form className="form" onSubmit={handleSubmit} noValidate>
            <p className="field-hint">
              {target.kind === 'report' ? (
                <>
                  The hiring manager will receive an email with a link to view {candidateName}’s complete assessment: all{' '}
                  {target.questionCount} questions with written answers and videos. The link expires after 7 days.
                </>
              ) : (
                <>
                  The hiring manager will receive an email with a link to view only {candidateName}’s answer to question{' '}
                  {target.questionNumber} (written answer and video). The link expires after 7 days.
                </>
              )}
            </p>
            <div className="field">
              <label htmlFor={`${titleId}-email`}>Hiring manager’s email</label>
              <input
                ref={inputRef}
                id={`${titleId}-email`}
                type="email"
                value={email}
                maxLength={254}
                onChange={(e) => setEmail(e.target.value)}
                aria-invalid={Boolean(fieldError)}
                aria-describedby={fieldError ? `${titleId}-email-error` : undefined}
                disabled={sending}
              />
              {fieldError && (
                <span id={`${titleId}-email-error`} className="field-error">
                  {fieldError}
                </span>
              )}
            </div>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <div className="dialog-actions">
              <button type="button" className="button-secondary" onClick={onClose} disabled={sending}>
                Cancel
              </button>
              <button type="submit" className="button-primary" disabled={sending}>
                {sending ? 'Sending…' : error ? 'Try again' : 'Send'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
