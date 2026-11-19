import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError } from '../services/apiClient';
import { listCandidates, resendConfirmationEmail, resendInvitation } from '../services/recruiterService';
import type { CandidateListItem, CandidateListResponse, InvitationActionResult } from '../types/recruiter';
import { formatShortDateTime } from '../utils/format';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { CreateCandidateDialog } from '../components/dashboard/CreateCandidateDialog';
import { StatusBadge } from '../components/dashboard/StatusBadge';

/** Tunable for tests. */
export const dashboardSettings = { searchDebounceMs: 300, pageSize: 50 };

type Feedback = { kind: 'success' | 'warning' | 'error'; text: string } | null;

function errorText(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.status === 0 ? err.message : err.message || fallback;
  return fallback;
}

export function DashboardPage() {
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [reloadKey, setReloadKey] = useState(0);
  const [data, setData] = useState<CandidateListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [creating, setCreating] = useState(false);
  const [resendTarget, setResendTarget] = useState<CandidateListItem | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Load the list whenever the search, page or reload counter changes.
  useEffect(() => {
    let cancelled = false;
    listCandidates({ search, page, limit: dashboardSettings.pageSize })
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setLoadError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // 401 is handled globally (session ends and the login page is shown).
        if (err instanceof ApiError && err.status === 401) return;
        setLoadError(errorText(err, 'The candidate list could not be loaded.'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [search, page, reloadKey]);

  // Debounce typing in the search box.
  useEffect(() => {
    const value = searchInput.trim();
    if (value === search) return;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setPage(1);
      setSearch(value);
    }, dashboardSettings.searchDebounceMs);
    return () => window.clearTimeout(timer);
  }, [searchInput, search]);

  const refresh = useCallback(() => {
    setLoading(true);
    setReloadKey((k) => k + 1);
  }, []);

  const goToPage = (next: number) => {
    setLoading(true);
    setPage(next);
  };

  function handleCreated(result: InvitationActionResult) {
    setCreating(false);
    setFeedback(
      result.email.sent
        ? { kind: 'success', text: `Invitation sent to ${result.candidate.name} (${result.candidate.email}).` }
        : {
            kind: 'warning',
            text: `${result.candidate.name} was created, but the invitation email could not be sent${result.email.error ? `: ${result.email.error}` : '.'} Use "Resend invitation" to try again.`,
          },
    );
    setSearchInput('');
    setSearch('');
    setPage(1);
    refresh();
  }

  async function confirmResendInvitation() {
    const item = resendTarget;
    if (!item) return;
    setBusyId(item.id);
    try {
      const result = await resendInvitation(item.id);
      setFeedback(
        result.email.sent
          ? { kind: 'success', text: `A new invitation was sent to ${item.candidate.email}. The previous link no longer works.` }
          : {
              kind: 'warning',
              text: `A new link was created for ${item.candidate.email}, but the email could not be sent${result.email.error ? `: ${result.email.error}` : '.'}`,
            },
      );
      refresh();
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 401)) {
        setFeedback({ kind: 'error', text: `Could not resend the invitation to ${item.candidate.email}. ${errorText(err, '')}`.trim() });
      }
    } finally {
      setBusyId(null);
      setResendTarget(null);
    }
  }

  async function handleResendConfirmation(item: CandidateListItem) {
    setBusyId(item.id);
    try {
      const result = await resendConfirmationEmail(item.id);
      setFeedback(
        result.email.sent
          ? { kind: 'success', text: `Confirmation email sent to ${item.candidate.email}.` }
          : {
              kind: 'warning',
              text: `The confirmation email to ${item.candidate.email} could not be sent${result.email.error ? `: ${result.email.error}` : '.'}`,
            },
      );
      refresh();
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 401)) {
        setFeedback({ kind: 'error', text: `Could not resend the confirmation email. ${errorText(err, '')}`.trim() });
      }
    } finally {
      setBusyId(null);
    }
  }

  const items = data?.items ?? [];
  const pagination = data?.pagination;
  const firstLoad = loading && !data;

  return (
    <section className="page dashboard">
      <div className="dashboard-header">
        <h1>Candidates</h1>
        <div className="dashboard-actions">
          <button type="button" className="button-secondary" onClick={refresh} disabled={loading}>
            {loading && data ? 'Refreshing…' : 'Refresh'}
          </button>
          <button type="button" className="button-primary" onClick={() => setCreating(true)}>
            Create Candidate
          </button>
        </div>
      </div>

      <div className="field search-field">
        <label htmlFor="candidate-search">Search by name or email</label>
        <input
          id="candidate-search"
          type="search"
          value={searchInput}
          maxLength={100}
          placeholder="e.g. Priya or priya@example.com"
          onChange={(e) => setSearchInput(e.target.value)}
        />
      </div>

      {feedback && (
        <div
          className={feedback.kind === 'success' ? 'success feedback' : feedback.kind === 'warning' ? 'notice feedback' : 'form-error feedback'}
          role={feedback.kind === 'error' ? 'alert' : 'status'}
        >
          <span>{feedback.text}</span>
          <button type="button" className="button-link-plain" onClick={() => setFeedback(null)} aria-label="Dismiss message">
            ×
          </button>
        </div>
      )}

      {firstLoad && <p role="status">Loading candidates…</p>}

      {loadError && (
        <div className="form-error" role="alert">
          <p>{loadError}</p>
          <button type="button" className="button-secondary button-small" onClick={refresh}>
            Try again
          </button>
        </div>
      )}

      {data && !loadError && items.length === 0 && (
        <div className="empty-state">
          {data.search ? (
            <p>No candidates match “{data.search}”.</p>
          ) : (
            <>
              <p>No candidates yet.</p>
              <p className="field-hint">Use “Create Candidate” to invite your first candidate.</p>
            </>
          )}
        </div>
      )}

      {data && items.length > 0 && (
        <div className="table-wrap" aria-busy={loading}>
          <table className="candidate-table">
            <thead>
              <tr>
                <th scope="col">Candidate name</th>
                <th scope="col">Email</th>
                <th scope="col">Invitation date</th>
                <th scope="col">Expiry date</th>
                <th scope="col">Completion date</th>
                <th scope="col">Status</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td data-label="Candidate name" className="cell-name">
                    {item.candidate.name}
                  </td>
                  <td data-label="Email" className="cell-email">
                    {item.candidate.email}
                  </td>
                  <td data-label="Invitation date">{formatShortDateTime(item.invitedAt)}</td>
                  <td data-label="Expiry date">{formatShortDateTime(item.expiresAt)}</td>
                  <td data-label="Completion date">{item.completedAt ? formatShortDateTime(item.completedAt) : '—'}</td>
                  <td data-label="Status">
                    <StatusBadge item={item} />
                  </td>
                  <td data-label="Actions">
                    <div className="row-actions">
                      <Link
                        to={`/admin/candidates/${item.candidate.id}`}
                        className="button-secondary button-small"
                        aria-label={`Open report for ${item.candidate.name}`}
                      >
                        Report
                      </Link>
                      {item.canResendInvitation && (
                        <button
                          type="button"
                          className="button-secondary button-small"
                          disabled={busyId === item.id}
                          onClick={() => setResendTarget(item)}
                          aria-label={`Resend invitation to ${item.candidate.name}`}
                        >
                          Resend invitation
                        </button>
                      )}
                      {item.canResendConfirmation && (
                        <button
                          type="button"
                          className="button-secondary button-small"
                          disabled={busyId === item.id}
                          onClick={() => void handleResendConfirmation(item)}
                          aria-label={`Resend confirmation email to ${item.candidate.name}`}
                        >
                          {busyId === item.id ? 'Sending…' : 'Resend confirmation'}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pagination && pagination.total > 0 && (
        <div className="pagination">
          <span>
            Showing {(pagination.page - 1) * pagination.limit + 1}–
            {Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total}
          </span>
          {pagination.totalPages > 1 && (
            <div className="row-actions">
              <button
                type="button"
                className="button-secondary button-small"
                disabled={pagination.page <= 1 || loading}
                onClick={() => goToPage(pagination.page - 1)}
              >
                Previous
              </button>
              <button
                type="button"
                className="button-secondary button-small"
                disabled={pagination.page >= pagination.totalPages || loading}
                onClick={() => goToPage(pagination.page + 1)}
              >
                Next
              </button>
            </div>
          )}
        </div>
      )}

      {creating && <CreateCandidateDialog onCreated={handleCreated} onClose={() => setCreating(false)} />}

      {resendTarget && (
        <ConfirmDialog
          title="Resend invitation?"
          confirmLabel="Resend invitation"
          busyLabel="Sending…"
          busy={busyId === resendTarget.id}
          onConfirm={() => void confirmResendInvitation()}
          onCancel={() => setResendTarget(null)}
        >
          <p>
            A new invitation email with a new link will be sent to <strong>{resendTarget.candidate.email}</strong>, valid
            for 7 days. The previous link will stop working. Saved answers are kept.
          </p>
        </ConfirmDialog>
      )}
    </section>
  );
}
