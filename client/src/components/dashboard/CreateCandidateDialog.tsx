import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { ApiError } from '../../services/apiClient';
import { createCandidateInvitation } from '../../services/recruiterService';
import type { InvitationActionResult } from '../../types/recruiter';
import { validateCandidateInput, type CandidateFieldErrors } from '../../utils/validation';

interface Props {
  onCreated: (result: InvitationActionResult) => void;
  onClose: () => void;
}

/** Dialog to create a candidate and send their invitation (POST /api/invitations). */
export function CreateCandidateDialog({ onCreated, onClose }: Props) {
  const titleId = useId();
  const nameRef = useRef<HTMLInputElement | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [errors, setErrors] = useState<CandidateFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    nameRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [submitting, onClose]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return; // no duplicate submissions
    setFormError(null);
    const fieldErrors = validateCandidateInput(name, email);
    setErrors(fieldErrors);
    if (fieldErrors.name || fieldErrors.email) return;

    setSubmitting(true);
    try {
      const result = await createCandidateInvitation({ name: name.trim(), email: email.trim() });
      onCreated(result);
    } catch (err) {
      setSubmitting(false);
      if (err instanceof ApiError) {
        if (err.code === 'CANDIDATE_EXISTS') {
          setErrors({ email: 'A candidate with this email address already exists.' });
          return;
        }
        if (err.code === 'VALIDATION_ERROR' && err.details && typeof err.details === 'object') {
          const d = err.details as Record<string, string>;
          setErrors({ name: d.name, email: d.email });
          return;
        }
        setFormError(err.status === 0 ? err.message : `Could not create the candidate. ${err.message}`);
        return;
      }
      setFormError('Could not create the candidate. Please try again.');
    }
  }

  return (
    <div className="dialog-backdrop">
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <h2 id={titleId}>Create candidate</h2>
        <p className="field-hint">The candidate will receive an invitation email with a personal assessment link valid for 7 days.</p>
        <form className="form" onSubmit={handleSubmit} noValidate>
          <div className="field">
            <label htmlFor={`${titleId}-name`}>Candidate name</label>
            <input
              ref={nameRef}
              id={`${titleId}-name`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={200}
              autoComplete="off"
              aria-invalid={Boolean(errors.name)}
              aria-describedby={errors.name ? `${titleId}-name-error` : undefined}
              disabled={submitting}
            />
            {errors.name && (
              <span id={`${titleId}-name-error`} className="field-error">
                {errors.name}
              </span>
            )}
          </div>
          <div className="field">
            <label htmlFor={`${titleId}-email`}>Candidate email</label>
            <input
              id={`${titleId}-email`}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              maxLength={254}
              autoComplete="off"
              aria-invalid={Boolean(errors.email)}
              aria-describedby={errors.email ? `${titleId}-email-error` : undefined}
              disabled={submitting}
            />
            {errors.email && (
              <span id={`${titleId}-email-error`} className="field-error">
                {errors.email}
              </span>
            )}
          </div>
          {formError && (
            <p className="form-error" role="alert">
              {formError}
            </p>
          )}
          <div className="dialog-actions">
            <button type="button" className="button-secondary" onClick={onClose} disabled={submitting}>
              Cancel
            </button>
            <button type="submit" className="button-primary" disabled={submitting}>
              {submitting ? 'Sending invitation…' : 'Create and send invitation'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
