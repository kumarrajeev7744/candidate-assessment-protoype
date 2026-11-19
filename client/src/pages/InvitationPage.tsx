import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { validateInvitation } from '../services/invitationService';
import { ApiError } from '../services/apiClient';
import { formatDateTime } from '../utils/format';
import type { InvitationValidity } from '../types/invitation';

type ViewState =
  | { kind: 'loading' }
  | { kind: 'valid'; invitation: InvitationValidity }
  | { kind: 'invalid' }
  | { kind: 'expired' }
  | { kind: 'completed' }
  | { kind: 'error'; message: string };

function toViewState(err: unknown): ViewState {
  if (err instanceof ApiError) {
    if (err.status === 404) return { kind: 'invalid' };
    if (err.status === 410) return { kind: 'expired' };
    if (err.status === 409) return { kind: 'completed' };
    if (err.status === 0) return { kind: 'error', message: err.message };
  }
  return { kind: 'error', message: 'We could not check your invitation right now. Please try again.' };
}

/**
 * Landing page for the candidate's invitation link (/assessment/:token).
 * Only checks the link; the assessment itself is added in a later step.
 */
export function InvitationPage() {
  const { token = '' } = useParams();
  const [state, setState] = useState<ViewState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    validateInvitation(token)
      .then((invitation) => !cancelled && setState({ kind: 'valid', invitation }))
      .catch((err: unknown) => !cancelled && setState(toViewState(err)));
    return () => {
      cancelled = true;
    };
  }, [token, attempt]);

  const retry = useCallback(() => {
    setState({ kind: 'loading' });
    setAttempt((n) => n + 1);
  }, []);

  return (
    <section className="page candidate-page">
      {state.kind === 'loading' && <p role="status">Checking your invitation…</p>}

      {state.kind === 'valid' && (
        <>
          <h1>Welcome to your assessment</h1>
          <p>Your invitation link is valid.</p>
          <p>
            It expires on <strong>{formatDateTime(state.invitation.expiresAt)}</strong>.
          </p>
          <p className="notice" role="status">
            The assessment will open here soon. Please keep your invitation email.
          </p>
        </>
      )}

      {state.kind === 'invalid' && (
        <>
          <h1>Invitation not found</h1>
          <p>This invitation link is invalid. Please check that you copied the full link from your email.</p>
          <p>If you received a newer invitation email, please use the link in that email.</p>
        </>
      )}

      {state.kind === 'expired' && (
        <>
          <h1>Invitation expired</h1>
          <p>This invitation has expired. Please contact the recruiter to request a new link.</p>
        </>
      )}

      {state.kind === 'completed' && (
        <>
          <h1>Assessment already submitted</h1>
          <p>You have already completed this assessment. Thank you!</p>
        </>
      )}

      {state.kind === 'error' && (
        <>
          <h1>Something went wrong</h1>
          <p className="form-error" role="alert">
            {state.message}
          </p>
          <button type="button" className="button-primary" onClick={retry}>
            Try again
          </button>
        </>
      )}
    </section>
  );
}
