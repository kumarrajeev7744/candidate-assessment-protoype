import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { renderApp } from './helpers/renderApp';

const TOKEN = 'S'.repeat(43);

function installPublicApi(responses: Array<{ status: number; body: unknown } | 'network'>) {
  const calls: Array<{ path: string; headers: Record<string, string> }> = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ path: url.pathname.replace(/^\/api/, ''), headers: (init?.headers ?? {}) as Record<string, string> });
    const next = responses.length > 1 ? responses.shift()! : responses[0]!;
    if (next === 'network') throw new TypeError('Failed to fetch');
    return new Response(JSON.stringify(next.body), { status: next.status, headers: { 'Content-Type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls };
}

const SHARED = (n = 1) => ({
  candidateName: 'Priya Sharma',
  question: { number: 3, text: 'Describe a deal you closed.' },
  response: {
    writtenAnswer: 'I closed a large deal.',
    video: { status: 'Uploaded', available: true, url: `https://s3.test/v.webm?sig=${n}`, mimeType: 'video/webm', urlExpiresAt: '2030-01-01T00:00:00Z' },
  },
  expiresAt: '2026-11-27T10:00:00Z',
});

describe('Public shared response page', () => {
  it('shows exactly one question with its written answer and video, without login', async () => {
    const api = installPublicApi([{ status: 200, body: SHARED() }]);
    renderApp(`/shared-response/${TOKEN}`);
    expect(screen.getByRole('status')).toHaveTextContent('Loading shared response…');
    expect(await screen.findByRole('heading', { level: 1, name: 'Priya Sharma' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Question 3' })).toBeInTheDocument();
    expect(screen.getByText('Describe a deal you closed.')).toBeInTheDocument();
    expect(screen.getByText('I closed a large deal.')).toBeInTheDocument();
    expect(screen.getByLabelText('Video answer')).toHaveAttribute('src', 'https://s3.test/v.webm?sig=1');
    expect(screen.getByText(/This link expires on/)).toBeInTheDocument();

    // Only one question; nothing editable; no login form.
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(1);
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Recruiter login' })).not.toBeInTheDocument();
    expect(api.calls).toEqual([{ path: `/shared-responses/${TOKEN}`, headers: { Accept: 'application/json' } }]);
  });

  it('shows the invalid-link message for 404', async () => {
    installPublicApi([{ status: 404, body: { error: { code: 'SHARE_LINK_NOT_FOUND', message: 'x' } } }]);
    renderApp(`/shared-response/${TOKEN}`);
    expect(await screen.findByRole('heading', { name: 'Link not valid' })).toBeInTheDocument();
    expect(screen.getByText(/This link is invalid/)).toBeInTheDocument();
  });

  it('shows the expired-link message for 410', async () => {
    installPublicApi([{ status: 410, body: { error: { code: 'SHARE_LINK_EXPIRED', message: 'x' } } }]);
    renderApp(`/shared-response/${TOKEN}`);
    expect(await screen.findByRole('heading', { name: 'Link expired' })).toBeInTheDocument();
    expect(screen.getByText(/valid for 7 days/)).toBeInTheDocument();
  });

  it('shows a retryable error for network failures', async () => {
    installPublicApi(['network', { status: 200, body: SHARED() }]);
    renderApp(`/shared-response/${TOKEN}`);
    expect(await screen.findByRole('alert')).toHaveTextContent(/Unable to reach the server/);
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Priya Sharma' })).toBeInTheDocument();
  });

  it('shows a no-video state', async () => {
    const body = SHARED();
    body.response.video = { status: 'Missing', available: false, url: null as never, mimeType: null as never, urlExpiresAt: null as never };
    installPublicApi([{ status: 200, body }]);
    renderApp(`/shared-response/${TOKEN}`);
    expect(await screen.findByText('No video was recorded for this question.')).toBeInTheDocument();
  });

  it('gets a fresh video URL when the old one has expired', async () => {
    const api = installPublicApi([{ status: 200, body: SHARED(1) }, { status: 200, body: SHARED(2) }]);
    renderApp(`/shared-response/${TOKEN}`);
    const player = await screen.findByLabelText('Video answer');
    await act(async () => {
      fireEvent.error(player);
    });
    await waitFor(() => expect(screen.getByLabelText('Video answer')).toHaveAttribute('src', 'https://s3.test/v.webm?sig=2'));
    expect(api.calls).toHaveLength(2);
  });
});
