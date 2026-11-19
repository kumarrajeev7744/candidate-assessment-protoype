import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { ADMIN, futureIso, mockApi, renderApp } from './helpers/renderApp';
import { getStoredSession, storeSession } from '../src/utils/tokenStorage';

const loginOk = () => ({ status: 200, body: { token: 'jwt-token', expiresAt: futureIso(), admin: ADMIN } });

async function fillAndSubmit(email: string, password: string) {
  const user = userEvent.setup();
  if (email) await user.type(screen.getByLabelText('Email'), email);
  if (password) await user.type(screen.getByLabelText('Password'), password);
  await user.click(screen.getByRole('button', { name: 'Log in' }));
  return user;
}

describe('Login page', () => {
  it('renders email, password and a login button', () => {
    renderApp('/admin/login');
    expect(screen.getByRole('heading', { name: 'Recruiter login' })).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveAttribute('type', 'email');
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
    expect(screen.getByRole('button', { name: 'Log in' })).toBeEnabled();
  });

  it('validates required fields and email format without calling the API', async () => {
    const fetchMock = mockApi({});
    renderApp('/admin/login');

    await fillAndSubmit('', '');
    expect(screen.getByText('Email is required.')).toBeInTheDocument();
    expect(screen.getByText('Password is required.')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');

    await userEvent.type(screen.getByLabelText('Email'), 'not-an-email');
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }));
    expect(screen.getByText('Enter a valid email address.')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows a loading state, stores the token and redirects to the dashboard on success', async () => {
    let release!: () => void;
    const fetchMock = mockApi({
      'POST /auth/login': () => new Promise((resolve) => (release = () => resolve(loginOk()))),
    });
    renderApp('/admin/login');

    await fillAndSubmit('recruiter@example.com', 'Correct-Password-1');
    expect(screen.getByRole('button', { name: 'Signing in…' })).toBeDisabled();

    await act(async () => release());
    expect(await screen.findByRole('heading', { name: 'Candidates' })).toBeInTheDocument();
    expect(screen.getByRole('banner')).toHaveTextContent('recruiter@example.com');
    expect(getStoredSession()?.token).toBe('jwt-token');

    const [, init] = fetchMock.mock.calls[0]!;
    expect(JSON.parse(String(init?.body))).toEqual({ email: 'recruiter@example.com', password: 'Correct-Password-1' });
    // The password is never persisted.
    expect(JSON.stringify(sessionStorage)).not.toContain('Correct-Password-1');
  });

  it('displays an error for invalid credentials and clears the password', async () => {
    mockApi({
      'POST /auth/login': () => ({
        status: 401,
        body: { error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' } },
      }),
    });
    renderApp('/admin/login');

    await fillAndSubmit('recruiter@example.com', 'wrong-password');
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password.');
    expect(screen.getByLabelText('Password')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Log in' })).toBeEnabled();
    expect(getStoredSession()).toBeNull();
  });

  it('displays meaningful messages for rate limiting and network failures', async () => {
    mockApi({
      'POST /auth/login': () => ({ status: 429, body: { error: { code: 'TOO_MANY_REQUESTS', message: 'x' } } }),
    });
    renderApp('/admin/login');
    await fillAndSubmit('recruiter@example.com', 'pw');
    expect(await screen.findByRole('alert')).toHaveTextContent(/Too many login attempts/);

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await userEvent.type(screen.getByLabelText('Password'), 'pw');
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Unable to reach the server/);
  });

  it('redirects an already-authenticated admin to the dashboard', async () => {
    storeSession({ token: 'valid', expiresAt: futureIso() });
    mockApi({ 'GET /auth/me': () => ({ status: 200, body: { admin: ADMIN } }) });
    renderApp('/admin/login');
    expect(await screen.findByRole('heading', { name: 'Candidates' })).toBeInTheDocument();
  });
});

describe('ProtectedRoute', () => {
  it('redirects unauthenticated users to the login page', () => {
    mockApi({});
    renderApp('/admin/dashboard');
    expect(screen.getByRole('heading', { name: 'Recruiter login' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Candidates' })).not.toBeInTheDocument();
  });

  it('returns the user to the originally requested page after login', async () => {
    mockApi({ 'POST /auth/login': loginOk });
    renderApp('/admin');
    await fillAndSubmit('recruiter@example.com', 'Correct-Password-1');
    expect(await screen.findByRole('heading', { name: 'Candidates' })).toBeInTheDocument();
  });
});

describe('Session restore', () => {
  it('restores a valid session on refresh after validating it with /auth/me', async () => {
    storeSession({ token: 'valid-token', expiresAt: futureIso() });
    const fetchMock = mockApi({ 'GET /auth/me': () => ({ status: 200, body: { admin: ADMIN } }) });
    renderApp('/admin/dashboard');

    expect(screen.getByRole('status')).toHaveTextContent('Checking your session');
    expect(await screen.findByRole('heading', { name: 'Candidates' })).toBeInTheDocument();
    const [, init] = fetchMock.mock.calls[0]!;
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer valid-token');
  });

  it('clears an invalid token and redirects to login', async () => {
    storeSession({ token: 'tampered', expiresAt: futureIso() });
    mockApi({
      'GET /auth/me': () => ({ status: 401, body: { error: { code: 'INVALID_TOKEN', message: 'Invalid' } } }),
    });
    renderApp('/admin/dashboard');

    expect(await screen.findByRole('heading', { name: 'Recruiter login' })).toBeInTheDocument();
    expect(screen.getByText('Your session has expired. Please log in again.')).toBeInTheDocument();
    expect(getStoredSession()).toBeNull();
  });

  it('clears an expired token without calling the API', () => {
    storeSession({ token: 'old', expiresAt: new Date(Date.now() - 1000).toISOString() });
    const fetchMock = mockApi({});
    renderApp('/admin/dashboard');

    expect(screen.getByRole('heading', { name: 'Recruiter login' })).toBeInTheDocument();
    expect(screen.getByText('Your session has expired. Please log in again.')).toBeInTheDocument();
    expect(getStoredSession()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('signs out automatically when the token expires during use', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    storeSession({ token: 'short-lived', expiresAt: futureIso(5_000) });
    mockApi({ 'GET /auth/me': () => ({ status: 200, body: { admin: ADMIN } }) });
    renderApp('/admin/dashboard');
    expect(await screen.findByRole('heading', { name: 'Candidates' })).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(6_000);
    });
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Recruiter login' })).toBeInTheDocument());
    expect(getStoredSession()).toBeNull();
  });
});

describe('Logout', () => {
  it('clears authentication and returns to the login page', async () => {
    storeSession({ token: 'valid-token', expiresAt: futureIso() });
    const fetchMock = mockApi({
      'GET /auth/me': () => ({ status: 200, body: { admin: ADMIN } }),
      'POST /auth/logout': () => ({ status: 200, body: { message: 'Logged out' } }),
    });
    renderApp('/admin/dashboard');
    await screen.findByRole('heading', { name: 'Candidates' });
    expect(screen.getByRole('banner')).toHaveTextContent('recruiter@example.com');

    await userEvent.click(screen.getByRole('button', { name: 'Log out' }));

    expect(await screen.findByRole('heading', { name: 'Recruiter login' })).toBeInTheDocument();
    expect(getStoredSession()).toBeNull();
    expect(screen.queryByRole('button', { name: 'Log out' })).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true);

    // Protected pages are no longer accessible.
    expect(screen.queryByRole('heading', { name: 'Candidates' })).not.toBeInTheDocument();
  });
});
