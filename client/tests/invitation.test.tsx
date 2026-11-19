import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { futureIso, mockApi, renderApp } from './helpers/renderApp';

const TOKEN = 'A'.repeat(43);
const errorBody = (code: string) => ({ error: { code, message: code } });

describe('Candidate invitation page', () => {
  it('shows a loading state, then confirms a valid invitation with its expiry', async () => {
    const fetchMock = mockApi({
      [`GET /invitations/validate/${TOKEN}`]: () => ({
        status: 200,
        body: { valid: true, status: 'Invited', expiresAt: futureIso() },
      }),
    });
    renderApp(`/assessment/${TOKEN}`);

    expect(screen.getByRole('status')).toHaveTextContent('Checking your invitation');
    expect(await screen.findByRole('heading', { name: 'Welcome to your assessment' })).toBeInTheDocument();
    expect(screen.getByText(/It expires on/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Public endpoint: no admin token is sent.
    const [, init] = fetchMock.mock.calls[0]!;
    expect((init?.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it.each([
    [404, 'INVITATION_NOT_FOUND', 'Invitation not found', /invitation link is invalid/],
    [410, 'INVITATION_EXPIRED', 'Invitation expired', /contact the recruiter to request a new link/],
    [409, 'ASSESSMENT_COMPLETED', 'Assessment already submitted', /already completed this assessment/],
  ])('shows a clear message for HTTP %i', async (status, code, heading, text) => {
    mockApi({ [`GET /invitations/validate/${TOKEN}`]: () => ({ status, body: errorBody(code) }) });
    renderApp(`/assessment/${TOKEN}`);
    expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument();
    expect(screen.getByText(text)).toBeInTheDocument();
  });

  it('shows a network error with a working retry', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    renderApp(`/assessment/${TOKEN}`);
    expect(await screen.findByRole('alert')).toHaveTextContent(/Unable to reach the server/);

    mockApi({
      [`GET /invitations/validate/${TOKEN}`]: () => ({
        status: 200,
        body: { valid: true, status: 'Invited', expiresAt: futureIso() },
      }),
    });
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: 'Welcome to your assessment' })).toBeInTheDocument();
  });

  it('does not require recruiter login', async () => {
    mockApi({
      [`GET /invitations/validate/${TOKEN}`]: () => ({
        status: 200,
        body: { valid: true, status: 'In Progress', expiresAt: futureIso() },
      }),
    });
    renderApp(`/assessment/${TOKEN}`);
    expect(await screen.findByRole('heading', { name: 'Welcome to your assessment' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Recruiter login' })).not.toBeInTheDocument();
  });
});
