import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { getStoredSession, storeSession } from '../src/utils/tokenStorage';
import { broadcastLogout, onLogoutInOtherTab } from '../src/utils/authBroadcast';
import { ADMIN, futureIso, mockApi, renderApp } from './helpers/renderApp';

async function signedInDashboard() {
  storeSession({ token: 'jwt', expiresAt: futureIso() });
  mockApi({
    'GET /auth/me': () => ({ status: 200, body: { admin: ADMIN } }),
    'POST /auth/logout': () => ({ status: 200, body: { message: 'Logged out' } }),
  });
  renderApp('/admin/dashboard');
  await screen.findByRole('heading', { name: 'Candidates' });
}

describe('Logout across tabs', () => {
  it('ends this tab’s session when another tab logs out (BroadcastChannel)', async () => {
    await signedInDashboard();
    const otherTab = new BroadcastChannel('candidate-assessment-auth');
    await act(async () => {
      otherTab.postMessage({ type: 'logout', at: Date.now() });
    });
    otherTab.close();
    expect(await screen.findByRole('heading', { name: 'Recruiter login' })).toBeInTheDocument();
    expect(screen.getByText('You have been logged out in another tab.')).toBeInTheDocument();
    expect(getStoredSession()).toBeNull();
  });

  it('also reacts to the storage-event fallback', async () => {
    await signedInDashboard();
    await act(async () => {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: 'candidateAssessment.authEvent',
          newValue: JSON.stringify({ type: 'logout', at: Date.now() }),
        }),
      );
    });
    expect(await screen.findByRole('heading', { name: 'Recruiter login' })).toBeInTheDocument();
    expect(getStoredSession()).toBeNull();
  });

  it('ignores unrelated storage events', async () => {
    await signedInDashboard();
    await act(async () => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'something-else', newValue: 'logout' }));
    });
    expect(screen.getByRole('heading', { name: 'Candidates' })).toBeInTheDocument();
    expect(getStoredSession()).not.toBeNull();
  });

  it('logging out here notifies the other tabs, without sending any token', async () => {
    const received: unknown[] = [];
    const otherTab = new BroadcastChannel('candidate-assessment-auth');
    otherTab.onmessage = (m) => received.push(m.data);
    await signedInDashboard();
    await userEvent.click(screen.getByRole('button', { name: /Log out/ }));
    await waitFor(() => expect(received).toHaveLength(1));
    otherTab.close();
    expect(received[0]).toEqual({ type: 'logout', at: expect.any(Number) });
    expect(JSON.stringify(received)).not.toContain('jwt');
    expect(localStorage.getItem('candidateAssessment.authEvent')).not.toContain('jwt');
  });

  it('subscription helper delivers logout once per signal and can be removed', async () => {
    let calls = 0;
    const unsubscribe = onLogoutInOtherTab(() => (calls += 1));
    const other = new BroadcastChannel('candidate-assessment-auth');
    other.postMessage({ type: 'logout', at: 1 });
    await waitFor(() => expect(calls).toBe(1));
    unsubscribe();
    other.postMessage({ type: 'logout', at: 2 });
    await new Promise((r) => setTimeout(r, 30));
    other.close();
    expect(calls).toBe(1);
    expect(typeof broadcastLogout).toBe('function');
  });
});
