import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { dashboardSettings } from '../src/pages/DashboardPage';
import { getStoredSession, storeSession } from '../src/utils/tokenStorage';
import type { CandidateListItem } from '../src/types/recruiter';
import { ADMIN, futureIso, renderApp } from './helpers/renderApp';

const DAY = 86_400_000;

function item(overrides: Partial<CandidateListItem> & { name: string; email: string; id: string }): CandidateListItem {
  const { name, email, id, ...rest } = overrides;
  return {
    id,
    candidate: { id: `cand-${id}`, name, email },
    status: 'Invited',
    invitedAt: new Date(Date.now() - 2 * DAY).toISOString(),
    expiresAt: new Date(Date.now() + 5 * DAY).toISOString(),
    completedAt: null,
    isExpired: false,
    emailStatus: 'Sent',
    confirmationEmailStatus: null,
    confirmationEmailSentAt: null,
    canResendInvitation: true,
    canResendConfirmation: false,
    ...rest,
  };
}

const ROWS: CandidateListItem[] = [
  item({
    id: 'inv3',
    name: 'Neha Completed',
    email: 'neha@example.com',
    status: 'Completed',
    completedAt: new Date(Date.now() - DAY / 2).toISOString(),
    canResendInvitation: false,
    canResendConfirmation: true,
    confirmationEmailStatus: 'Failed',
  }),
  item({ id: 'inv2', name: 'Arjun Progress', email: 'arjun@example.com', status: 'In Progress' }),
  item({
    id: 'inv1',
    name: 'Priya Expired',
    email: 'priya@example.com',
    isExpired: true,
    emailStatus: 'Failed',
    expiresAt: new Date(Date.now() - DAY).toISOString(),
  }),
];

interface Backend {
  rows: CandidateListItem[];
  listStatus?: number;
  listDelayMs?: number;
  createResult?: { status: number; body: unknown };
  resendResult?: { status: number; body: unknown };
  confirmationResult?: { status: number; body: unknown };
}

/** Fake recruiter API: auth endpoints + candidate list (with search) + actions. */
function installBackend(backend: Backend) {
  const calls: Array<{ method: string; path: string; search: string; body: unknown; auth?: string }> = [];
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const path = url.pathname.replace(/^\/api/, '');
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const auth = (init?.headers as Record<string, string> | undefined)?.Authorization;
    calls.push({ method, path, search: url.search, body, auth });

    if (path === '/auth/me') return json(200, { admin: ADMIN });
    if (method === 'GET' && /^\/candidates\/[^/]+\/report$/.test(path)) {
      return json(404, { error: { code: 'CANDIDATE_NOT_FOUND', message: 'Candidate not found.' } });
    }
    if (path === '/auth/logout') return json(200, { message: 'Logged out' });
    if (method === 'GET' && path === '/invitations') {
      if (backend.listDelayMs) await new Promise((r) => setTimeout(r, backend.listDelayMs));
      if (backend.listStatus) {
        return json(backend.listStatus, { error: { code: 'ERR', message: backend.listStatus === 401 ? 'Invalid authentication token' : 'Server error' } });
      }
      const q = (url.searchParams.get('search') ?? '').toLowerCase();
      const rows = backend.rows.filter(
        (r) => !q || r.candidate.name.toLowerCase().includes(q) || r.candidate.email.toLowerCase().includes(q),
      );
      return json(200, { items: rows, pagination: { page: 1, limit: 50, total: rows.length, totalPages: 1 }, search: q });
    }
    if (method === 'POST' && path === '/invitations') {
      const result = backend.createResult ?? {
        status: 201,
        body: {
          candidate: { id: 'new', name: body.name, email: body.email, createdAt: new Date().toISOString() },
          invitation: { id: 'inv-new', status: 'Invited', emailStatus: 'Sent', expiresAt: futureIso() },
          email: { sent: true },
        },
      };
      if (result.status === 201) {
        backend.rows = [item({ id: 'inv-new', name: body.name, email: body.email }), ...backend.rows];
      }
      return json(result.status, result.body);
    }
    if (method === 'POST' && /^\/invitations\/[^/]+\/resend$/.test(path)) {
      const result = backend.resendResult ?? { status: 200, body: { candidate: {}, invitation: {}, email: { sent: true } } };
      return json(result.status, result.body);
    }
    if (method === 'POST' && /^\/invitations\/[^/]+\/resend-confirmation$/.test(path)) {
      const result = backend.confirmationResult ?? { status: 200, body: { candidate: {}, invitation: {}, email: { sent: true } } };
      if (result.status === 200 && (result.body as { email: { sent: boolean } }).email.sent) {
        backend.rows = backend.rows.map((r) =>
          r.id === path.split('/')[2] ? { ...r, confirmationEmailStatus: 'Sent', canResendConfirmation: false } : r,
        );
      }
      return json(result.status, result.body);
    }
    throw new Error(`Unexpected request: ${method} ${path}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetchMock, backend };
}

async function openDashboard(backend: Backend) {
  storeSession({ token: 'admin-jwt', expiresAt: futureIso() });
  const api = installBackend(backend);
  renderApp('/admin/dashboard');
  await screen.findByRole('heading', { name: 'Candidates' });
  return api;
}

/** Opens the "⋯" menu for a candidate and chooses an action by its accessible name. */
async function chooseAction(candidate: string, actionName: string) {
  await userEvent.click(screen.getByRole('button', { name: `More actions for ${candidate}` }));
  const menu = await screen.findByRole('menu', { name: `More actions for ${candidate}` });
  await userEvent.click(within(menu).getByRole('menuitem', { name: actionName }));
}

const listCalls = (api: ReturnType<typeof installBackend>) => api.calls.filter((c) => c.method === 'GET' && c.path === '/invitations');
const rowFor = (name: string) => screen.getByRole('cell', { name }).closest('tr')!;

beforeEach(() => {
  dashboardSettings.searchDebounceMs = 20;
});
afterAll(() => {
  dashboardSettings.searchDebounceMs = 300;
});

describe('Recruiter dashboard', () => {
  it('requires login', () => {
    installBackend({ rows: ROWS });
    renderApp('/admin/dashboard');
    expect(screen.getByRole('heading', { name: 'Recruiter login' })).toBeInTheDocument();
  });

  it('shows a loading state, then the candidate table with all columns', async () => {
    const api = await openDashboard({ rows: ROWS, listDelayMs: 50 });
    expect(screen.getByRole('status')).toHaveTextContent('Loading candidates…');
    await screen.findByRole('table');

    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toEqual(['Candidate name', 'Email', 'Invitation date', 'Expiry date', 'Completion date', 'Status', 'Actions']);
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows.map((r) => within(r).getAllByRole('cell')[0]!.textContent)).toEqual([
      'Neha Completed',
      'Arjun Progress',
      'Priya Expired',
    ]);

    const neha = rowFor('Neha Completed');
    expect(within(neha).getByText('Completed')).toBeInTheDocument();
    expect(within(neha).getAllByRole('cell')[4]!.textContent).not.toBe('—');
    expect(within(neha).getByText('Confirmation email failed')).toBeInTheDocument();
    expect(within(rowFor('Arjun Progress')).getByText('In Progress')).toBeInTheDocument();
    expect(within(rowFor('Arjun Progress')).getAllByRole('cell')[4]).toHaveTextContent('—');
    const priya = rowFor('Priya Expired');
    expect(within(priya).getByText('Invited')).toBeInTheDocument();
    expect(within(priya).getByText('Expired')).toBeInTheDocument();
    expect(within(priya).getByText('Invitation email failed')).toBeInTheDocument();

    expect(screen.getByText('Showing 1–3 of 3')).toBeInTheDocument();
    expect(listCalls(api)[0]!.auth).toBe('Bearer admin-jwt');
  });

  it('shows Report for everyone and only the applicable actions in the "⋯" menu', async () => {
    await openDashboard({
      rows: [
        ...ROWS,
        item({ id: 'inv4', name: 'Done Sent', email: 'sent@example.com', status: 'Completed', canResendInvitation: false, canResendConfirmation: false, confirmationEmailStatus: 'Sent' }),
      ],
    });
    await screen.findByRole('table');

    await userEvent.click(within(rowFor('Neha Completed')).getByRole('button', { name: 'More actions for Neha Completed' }));
    let menu = screen.getByRole('menu', { name: 'More actions for Neha Completed' });
    expect(within(menu).getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Resend confirmation email']);
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    await userEvent.click(within(rowFor('Arjun Progress')).getByRole('button', { name: 'More actions for Arjun Progress' }));
    menu = screen.getByRole('menu', { name: 'More actions for Arjun Progress' });
    expect(within(menu).getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Resend invitation']);
    await userEvent.keyboard('{Escape}');

    // No applicable actions → no "⋯" button at all.
    expect(within(rowFor('Done Sent')).queryByRole('button', { name: /More actions/ })).not.toBeInTheDocument();
    for (const name of ['Neha Completed', 'Arjun Progress', 'Priya Expired', 'Done Sent']) {
      expect(within(rowFor(name)).getByRole('link', { name: `Open report for ${name}` })).toBeInTheDocument();
    }
  });

  it('shows an empty state when there are no candidates', async () => {
    await openDashboard({ rows: [] });
    expect(await screen.findByText('No candidates yet.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('shows an error state with retry', async () => {
    const api = await openDashboard({ rows: ROWS, listStatus: 500 });
    expect(await screen.findByRole('alert')).toHaveTextContent('Server error');
    api.backend.listStatus = undefined;
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('table')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('searches by name or email (debounced, server-side)', async () => {
    const api = await openDashboard({ rows: ROWS });
    await screen.findByRole('table');
    await userEvent.type(screen.getByLabelText('Search by name or email'), 'arjun@');
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(2));
    expect(rowFor('Arjun Progress')).toBeInTheDocument();
    expect(listCalls(api).at(-1)!.search).toBe('?search=arjun%40&limit=50');
    expect(listCalls(api).length).toBeLessThanOrEqual(3); // initial + debounced (not one per keystroke)

    await userEvent.clear(screen.getByLabelText('Search by name or email'));
    await userEvent.type(screen.getByLabelText('Search by name or email'), 'zzz');
    expect(await screen.findByText('No candidates match “zzz”.')).toBeInTheDocument();
  });

  it('refreshes the list', async () => {
    const api = await openDashboard({ rows: ROWS });
    await screen.findByRole('table');
    api.backend.rows = [...ROWS, item({ id: 'inv9', name: 'Late Arrival', email: 'late@example.com' })];
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByRole('cell', { name: 'Late Arrival' })).toBeInTheDocument();
  });

  it('navigates to the candidate report', async () => {
    const api = await openDashboard({ rows: ROWS });
    await screen.findByRole('table');
    await userEvent.click(screen.getByRole('link', { name: 'Open report for Arjun Progress' }));
    expect(await screen.findByRole('heading', { name: 'Candidate not found' })).toBeInTheDocument();
    expect(api.calls.some((c) => c.path === '/candidates/cand-inv2/report')).toBe(true);
    await userEvent.click(screen.getByRole('link', { name: '← Back to candidates' }));
    expect(await screen.findByRole('heading', { name: 'Candidates' })).toBeInTheDocument();
  });

  it('ends the session and shows login when the API rejects the token', async () => {
    await openDashboard({ rows: ROWS, listStatus: 401 });
    expect(await screen.findByRole('heading', { name: 'Recruiter login' })).toBeInTheDocument();
    expect(screen.getByText('Your session has expired. Please log in again.')).toBeInTheDocument();
    expect(getStoredSession()).toBeNull();
  });
});

describe('Create candidate', () => {
  async function openCreate(backend: Backend = { rows: ROWS }) {
    const api = await openDashboard(backend);
    await screen.findByRole('table');
    await userEvent.click(screen.getByRole('button', { name: 'Create Candidate' }));
    const dialog = await screen.findByRole('dialog', { name: 'Create candidate' });
    return { api, dialog };
  }

  it('validates name and email before calling the API', async () => {
    const { api, dialog } = await openCreate();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create and send invitation' }));
    expect(within(dialog).getByText('Name is required.')).toBeInTheDocument();
    expect(within(dialog).getByText('Email is required.')).toBeInTheDocument();

    await userEvent.type(within(dialog).getByLabelText('Candidate name'), '<b>x</b>');
    await userEvent.type(within(dialog).getByLabelText('Candidate email'), 'not-an-email');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create and send invitation' }));
    expect(within(dialog).getByText('Name contains invalid characters.')).toBeInTheDocument();
    expect(within(dialog).getByText('Enter a valid email address.')).toBeInTheDocument();
    expect(api.calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('creates the candidate, shows success and refreshes the list', async () => {
    const { api, dialog } = await openCreate();
    await userEvent.type(within(dialog).getByLabelText('Candidate name'), '  Kavya Rao ');
    await userEvent.type(within(dialog).getByLabelText('Candidate email'), 'kavya@example.com');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create and send invitation' }));

    expect(await screen.findByText('Invitation sent to Kavya Rao (kavya@example.com).')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(await screen.findByRole('cell', { name: 'Kavya Rao' })).toBeInTheDocument();
    const post = api.calls.find((c) => c.method === 'POST' && c.path === '/invitations')!;
    expect(post.body).toEqual({ name: 'Kavya Rao', email: 'kavya@example.com' });
    expect(post.auth).toBe('Bearer admin-jwt');
  });

  it('prevents duplicate submissions while the request is in progress', async () => {
    let release!: () => void;
    const { api, dialog } = await openCreate();
    const original = api.fetchMock.getMockImplementation()!;
    api.fetchMock.mockImplementation(async (input, init) => {
      if (init?.method === 'POST') await new Promise<void>((r) => (release = r));
      return original(input, init);
    });
    await userEvent.type(within(dialog).getByLabelText('Candidate name'), 'Kavya Rao');
    await userEvent.type(within(dialog).getByLabelText('Candidate email'), 'kavya@example.com');
    const submit = within(dialog).getByRole('button', { name: 'Create and send invitation' });
    await userEvent.click(submit);
    const busy = within(dialog).getByRole('button', { name: 'Sending invitation…' });
    expect(busy).toBeDisabled();
    await userEvent.click(busy);
    await act(async () => release());
    await screen.findByText(/Invitation sent to Kavya Rao/);
    expect(api.calls.filter((c) => c.method === 'POST')).toHaveLength(1);
  });

  it('shows a duplicate-email error from the backend', async () => {
    const { dialog } = await openCreate({
      rows: ROWS,
      createResult: {
        status: 409,
        body: { error: { code: 'CANDIDATE_EXISTS', message: 'A candidate with this email address already exists.' } },
      },
    });
    await userEvent.type(within(dialog).getByLabelText('Candidate name'), 'Priya Again');
    await userEvent.type(within(dialog).getByLabelText('Candidate email'), 'priya@example.com');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create and send invitation' }));
    expect(await within(dialog).findByText('A candidate with this email address already exists.')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Create and send invitation' })).toBeEnabled();
  });

  it('shows backend validation errors and server failures', async () => {
    const { api, dialog } = await openCreate({
      rows: ROWS,
      createResult: { status: 400, body: { error: { code: 'VALIDATION_ERROR', message: 'Validation failed', details: { name: 'Name must be at most 200 characters' } } } },
    });
    await userEvent.type(within(dialog).getByLabelText('Candidate name'), 'Valid Name');
    await userEvent.type(within(dialog).getByLabelText('Candidate email'), 'v@example.com');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create and send invitation' }));
    expect(await within(dialog).findByText('Name must be at most 200 characters')).toBeInTheDocument();

    api.backend.createResult = { status: 500, body: { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } } };
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create and send invitation' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Could not create the candidate. Internal server error');
  });

  it('warns when the candidate was created but the email failed', async () => {
    const { dialog } = await openCreate({
      rows: ROWS,
      createResult: {
        status: 201,
        body: {
          candidate: { id: 'n', name: 'Kavya Rao', email: 'kavya@example.com', createdAt: '' },
          invitation: { id: 'inv-n', status: 'Invited', emailStatus: 'Failed', expiresAt: futureIso() },
          email: { sent: false, error: 'The email could not be delivered. Please try again later.' },
        },
      },
    });
    await userEvent.type(within(dialog).getByLabelText('Candidate name'), 'Kavya Rao');
    await userEvent.type(within(dialog).getByLabelText('Candidate email'), 'kavya@example.com');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create and send invitation' }));
    expect(await screen.findByText(/Kavya Rao was created, but the invitation email could not be sent/)).toBeInTheDocument();
    expect(screen.getByText(/Use "Resend invitation" to try again/)).toBeInTheDocument();
  });

  it('can be cancelled', async () => {
    const { dialog } = await openCreate();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('Resend actions', () => {
  it('resends an invitation after confirmation and refreshes the list', async () => {
    const api = await openDashboard({ rows: ROWS });
    await screen.findByRole('table');
    const before = listCalls(api).length;
    await chooseAction('Arjun Progress', 'Resend invitation to Arjun Progress');
    const dialog = await screen.findByRole('dialog', { name: 'Resend invitation?' });
    expect(dialog).toHaveTextContent('The previous link will stop working');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Resend invitation' }));

    expect(await screen.findByText('A new invitation was sent to arjun@example.com. The previous link no longer works.')).toBeInTheDocument();
    expect(api.calls.some((c) => c.method === 'POST' && c.path === '/invitations/inv2/resend')).toBe(true);
    await waitFor(() => expect(listCalls(api).length).toBe(before + 1));
  });

  it('does not resend when the confirmation dialog is cancelled', async () => {
    const api = await openDashboard({ rows: ROWS });
    await screen.findByRole('table');
    await chooseAction('Priya Expired', 'Resend invitation to Priya Expired');
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    expect(api.calls.some((c) => c.path.endsWith('/resend'))).toBe(false);
  });

  it('shows resend invitation errors', async () => {
    await openDashboard({
      rows: ROWS,
      resendResult: { status: 503, body: { error: { code: 'EMAIL_NOT_CONFIGURED', message: 'Email service is not configured.' } } },
    });
    await screen.findByRole('table');
    await chooseAction('Arjun Progress', 'Resend invitation to Arjun Progress');
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Resend invitation' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not resend the invitation to arjun@example.com. Email service is not configured.',
    );
  });

  it('resends a failed confirmation email and hides the action once sent', async () => {
    const api = await openDashboard({ rows: ROWS });
    await screen.findByRole('table');
    await chooseAction('Neha Completed', 'Resend confirmation email to Neha Completed');
    expect(await screen.findByText('Confirmation email sent to neha@example.com.')).toBeInTheDocument();
    expect(api.calls.some((c) => c.method === 'POST' && c.path === '/invitations/inv3/resend-confirmation')).toBe(true);
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'More actions for Neha Completed' })).not.toBeInTheDocument(),
    );
  });

  it('reports a confirmation email that failed again', async () => {
    await openDashboard({
      rows: ROWS,
      confirmationResult: { status: 200, body: { candidate: {}, invitation: {}, email: { sent: false, error: 'The email could not be delivered.' } } },
    });
    await screen.findByRole('table');
    await chooseAction('Neha Completed', 'Resend confirmation email to Neha Completed');
    expect(await screen.findByText(/could not be sent: The email could not be delivered/)).toBeInTheDocument();
  });

  it('shows confirmation resend errors', async () => {
    await openDashboard({
      rows: ROWS,
      confirmationResult: { status: 409, body: { error: { code: 'CONFIRMATION_ALREADY_SENT', message: 'The confirmation email has already been sent.' } } },
    });
    await screen.findByRole('table');
    await chooseAction('Neha Completed', 'Resend confirmation email to Neha Completed');
    expect(await screen.findByRole('alert')).toHaveTextContent('The confirmation email has already been sent.');
  });
});

describe('Row actions menu', () => {
  it('works with the keyboard and closes on outside click', async () => {
    await openDashboard({ rows: ROWS });
    await screen.findByRole('table');
    const trigger = screen.getByRole('button', { name: 'More actions for Arjun Progress' });
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    trigger.focus();
    await userEvent.keyboard('{ArrowDown}');
    const menu = screen.getByRole('menu');
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(within(menu).getByRole('menuitem', { name: 'Resend invitation to Arjun Progress' })).toHaveFocus();

    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();

    await userEvent.click(trigger);
    expect(screen.getByRole('menu')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('heading', { name: 'Candidates' }));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('opens the resend confirmation dialog from the keyboard', async () => {
    await openDashboard({ rows: ROWS });
    await screen.findByRole('table');
    screen.getByRole('button', { name: 'More actions for Priya Expired' }).focus();
    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard('{Enter}');
    expect(await screen.findByRole('dialog', { name: 'Resend invitation?' })).toBeInTheDocument();
  });
});
