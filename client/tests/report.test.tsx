import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { storeSession } from '../src/utils/tokenStorage';
import type { CandidateReport } from '../src/types/report';
import { ADMIN, futureIso, renderApp } from './helpers/renderApp';
import { CANDIDATE_ID, makeReport, question, video } from './helpers/reportFixtures';

interface Backend {
  report: CandidateReport;
  reportStatus?: number;
  reportDelayMs?: number;
  shareResults?: Array<{ status: number; body: unknown }>;
  shareDelayMs?: number;
}

function installBackend(backend: Backend) {
  const calls: Array<{ method: string; path: string; body: unknown }> = [];
  let reportCalls = 0;
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const path = url.pathname.replace(/^\/api/, '');
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path, body });
    if (path === '/auth/me') return json(200, { admin: ADMIN });
    if (method === 'GET' && path === '/invitations') {
      return json(200, { items: [], pagination: { page: 1, limit: 50, total: 0, totalPages: 1 }, search: '' });
    }
    if (method === 'GET' && path === `/candidates/${CANDIDATE_ID}/report`) {
      reportCalls += 1;
      if (backend.reportDelayMs) await new Promise((r) => setTimeout(r, backend.reportDelayMs));
      if (backend.reportStatus) {
        const message = backend.reportStatus === 404 ? 'Candidate not found.' : 'Internal server error';
        return json(backend.reportStatus, { error: { code: 'ERR', message } });
      }
      // Each load returns fresh presigned URLs.
      const fresh = structuredClone(backend.report);
      for (const q of fresh.questions) if (q.response?.video.url) q.response.video.url += `&v=${reportCalls}`;
      return json(200, fresh);
    }
    const share = /^\/responses\/([^/]+)\/share$/.exec(path);
    if (method === 'POST' && share) {
      if (backend.shareDelayMs) await new Promise((r) => setTimeout(r, backend.shareDelayMs));
      const result = backend.shareResults?.shift() ?? {
        status: 201,
        body: {
          shareLink: { id: 's1', recipientEmail: body.recipientEmail.toLowerCase(), createdAt: '', expiresAt: '2026-11-27T10:00:00Z', emailStatus: 'Sent', emailSentAt: '' },
          reused: false,
          email: { sent: true },
        },
      };
      return json(result.status, result.body);
    }
    throw new Error(`Unexpected request: ${method} ${path}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetchMock, reportCount: () => reportCalls };
}

async function openReport(backend: Backend) {
  storeSession({ token: 'admin-jwt', expiresAt: futureIso() });
  const api = installBackend(backend);
  renderApp(`/admin/candidates/${CANDIDATE_ID}`);
  return api;
}

const item = (n: number) => screen.getByRole('listitem', { name: `Question ${n}` });

describe('Candidate report page', () => {
  it('shows loading, then candidate details and all 10 questions in order', async () => {
    await openReport({ report: makeReport(), reportDelayMs: 40 });
    expect(await screen.findByText('Loading report…')).toBeInTheDocument();
    expect(await screen.findByRole('heading', { level: 1, name: 'Priya Sharma' })).toBeInTheDocument();

    expect(screen.getByText('priya@example.com')).toBeInTheDocument();
    for (const label of ['Status', 'Invitation date', 'Completion date', 'Expiry date']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText('10 of 10')).toBeInTheDocument();
    const items = screen.getAllByRole('listitem', { name: /^Question \d+$/ });
    expect(items.map((i) => within(i).getByRole('heading', { level: 2 }).textContent)).toEqual(
      Array.from({ length: 10 }, (_, i) => `Question ${i + 1}`),
    );
  });

  it('shows written answers and video playback', async () => {
    await openReport({ report: makeReport() });
    await screen.findByRole('heading', { level: 1, name: 'Priya Sharma' });
    expect(within(item(4)).getByText('Report question 4?')).toBeInTheDocument();
    expect(within(item(4)).getByText('Written answer 4')).toBeInTheDocument();
    const player = within(item(4)).getByLabelText('Video answer to question 4');
    expect(player.tagName).toBe('VIDEO');
    expect(player).toHaveAttribute('src', expect.stringMatching(/^https:\/\/s3\.test\/v\/4\.webm/));
    expect(player).toHaveAttribute('controls');
  });

  it('shows clear missing-response states and completion status', async () => {
    const report = makeReport({
      assessment: { ...makeReport().assessment, status: 'In Progress', completedAt: null },
      questions: [
        question(1, { canShare: false }),
        question(2, { status: 'Not Started', response: null, canShare: false }),
        question(3, {
          status: 'Incomplete',
          canShare: false,
          response: { ...question(3).response!, writtenAnswer: '', hasWrittenAnswer: false },
        }),
        question(4, {
          status: 'Incomplete',
          canShare: false,
          response: { ...question(4).response!, video: video(4, { status: 'Failed', available: false, url: null }) },
        }),
        ...Array.from({ length: 6 }, (_, i) => question(i + 5, { canShare: false })),
      ],
      summary: { completedQuestions: 7, totalQuestions: 10 },
    });
    await openReport({ report });
    await screen.findByRole('heading', { level: 1, name: 'Priya Sharma' });

    expect(screen.getByText('Not completed')).toBeInTheDocument();
    expect(screen.getByText(/has not been submitted yet/)).toBeInTheDocument();
    expect(within(item(2)).getByText('Not Started')).toBeInTheDocument();
    expect(within(item(2)).getByText('No written answer')).toBeInTheDocument();
    expect(within(item(2)).getByText('No video recorded')).toBeInTheDocument();
    expect(within(item(3)).getByText('Incomplete')).toBeInTheDocument();
    expect(within(item(3)).getByText('No written answer')).toBeInTheDocument();
    expect(within(item(4)).getByText('Video upload failed')).toBeInTheDocument();
    expect(within(item(1)).getByText('Complete')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Share question/ })).not.toBeInTheDocument();
  });

  it('shows an error with retry, and a not-found state', async () => {
    const api = await openReport({ report: makeReport(), reportStatus: 500 });
    expect(await screen.findByRole('heading', { name: 'Could not load the report' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Internal server error');
    (api as unknown as { backend?: Backend }).backend = undefined;
    installBackend({ report: makeReport() });
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Priya Sharma' })).toBeInTheDocument();
  });

  it('shows a not-found state for unknown candidates', async () => {
    await openReport({ report: makeReport(), reportStatus: 404 });
    expect(await screen.findByRole('heading', { name: 'Candidate not found' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });

  it('links back to the dashboard', async () => {
    await openReport({ report: makeReport() });
    await screen.findByRole('heading', { level: 1, name: 'Priya Sharma' });
    await userEvent.click(screen.getByRole('link', { name: '← Back to candidates' }));
    expect(await screen.findByRole('heading', { name: 'Candidates' })).toBeInTheDocument();
  });

  it('fetches a fresh video URL when playback fails (expired URL) and offers retry if it fails again', async () => {
    const api = await openReport({ report: makeReport() });
    await screen.findByRole('heading', { level: 1, name: 'Priya Sharma' });
    const player = within(item(2)).getByLabelText('Video answer to question 2');
    const firstSrc = player.getAttribute('src');

    await act(async () => {
      fireEvent.error(player);
    });
    await waitFor(() =>
      expect(within(item(2)).getByLabelText('Video answer to question 2').getAttribute('src')).not.toBe(firstSrc),
    );
    expect(api.reportCount()).toBe(2);

    await act(async () => {
      fireEvent.error(within(item(2)).getByLabelText('Video answer to question 2'));
    });
    expect(within(item(2)).getByRole('button', { name: 'Retry video' })).toBeInTheDocument();
    await userEvent.click(within(item(2)).getByRole('button', { name: 'Retry video' }));
    expect(await within(item(2)).findByLabelText('Video answer to question 2')).toBeInTheDocument();
    expect(api.reportCount()).toBe(3);
  });

  it('is responsive: report and dialog content is not width-constrained by tables', async () => {
    await openReport({ report: makeReport() });
    await screen.findByRole('heading', { level: 1, name: 'Priya Sharma' });
    expect(document.querySelector('.report table')).toBeNull();
    expect(document.querySelector('.report-details')).not.toBeNull(); // auto-fit grid collapses on phones
  });
});

describe('Share dialog', () => {
  async function openShare(backend: Partial<Backend> = {}) {
    const api = await openReport({ report: makeReport(), ...backend });
    await screen.findByRole('heading', { level: 1, name: 'Priya Sharma' });
    await userEvent.click(within(item(3)).getByRole('button', { name: 'Share question 3' }));
    const dialog = await screen.findByRole('dialog', { name: 'Share question 3' });
    return { api, dialog };
  }
  const shareCalls = (api: ReturnType<typeof installBackend>) => api.calls.filter((c) => c.method === 'POST');

  it('opens and closes without creating a share', async () => {
    const { api, dialog } = await openShare();
    expect(dialog).toHaveTextContent('only Priya Sharma’s answer to question 3');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await userEvent.click(within(item(3)).getByRole('button', { name: 'Share question 3' }));
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(shareCalls(api)).toHaveLength(0);
  });

  it('validates the email before sending', async () => {
    const { api, dialog } = await openShare();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send' }));
    expect(within(dialog).getByText('Recipient email is required.')).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText('Hiring manager’s email'), 'manager@');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send' }));
    expect(within(dialog).getByText('Enter a valid email address.')).toBeInTheDocument();
    expect(shareCalls(api)).toHaveLength(0);
  });

  it('shares the response and confirms', async () => {
    const { api, dialog } = await openShare();
    await userEvent.type(within(dialog).getByLabelText('Hiring manager’s email'), 'Manager@Example.com');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send' }));
    expect(await within(dialog).findByRole('status')).toHaveTextContent('The response was shared with manager@example.com');
    const [call] = shareCalls(api);
    expect(call!.path).toBe(`/responses/${'r3'.padEnd(24, '0')}/share`);
    expect(call!.body).toEqual({ candidateId: CANDIDATE_ID, recipientEmail: 'Manager@Example.com' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows a failure and allows retry', async () => {
    const { api, dialog } = await openShare({
      shareResults: [
        { status: 502, body: { error: { code: 'EMAIL_DELIVERY_FAILED', message: 'The share email could not be sent.' } } },
      ],
    });
    await userEvent.type(within(dialog).getByLabelText('Hiring manager’s email'), 'manager@example.com');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('The email could not be sent, so nothing was shared.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Try again' }));
    expect(await within(dialog).findByRole('status')).toHaveTextContent('shared with manager@example.com');
    expect(shareCalls(api)).toHaveLength(2);
  });

  it('shows other API errors', async () => {
    const { dialog } = await openShare({
      shareResults: [{ status: 409, body: { error: { code: 'ASSESSMENT_NOT_COMPLETED', message: 'Responses can be shared once the candidate has submitted the assessment.' } } }],
    });
    await userEvent.type(within(dialog).getByLabelText('Hiring manager’s email'), 'manager@example.com');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Could not share the response. Responses can be shared once');
  });

  it('prevents duplicate submissions while sending', async () => {
    const { api, dialog } = await openShare({ shareDelayMs: 80 });
    await userEvent.type(within(dialog).getByLabelText('Hiring manager’s email'), 'manager@example.com');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send' }));
    const sending = within(dialog).getByRole('button', { name: 'Sending…' });
    expect(sending).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled();
    fireEvent.submit(sending.closest('form')!);
    await within(dialog).findByRole('status');
    expect(shareCalls(api)).toHaveLength(1);
  });
});

describe('Video failure diagnostics', () => {
  async function failTwice(n: number) {
    await act(async () => {
      fireEvent.error(within(item(n)).getByLabelText(`Video answer to question ${n}`));
    });
    await waitFor(() => expect(within(item(n)).getByLabelText(`Video answer to question ${n}`)).toBeInTheDocument());
    await act(async () => {
      fireEvent.error(within(item(n)).getByLabelText(`Video answer to question ${n}`));
    });
  }

  it('explains an S3 access error', async () => {
    const api = await openReport({ report: makeReport() });
    await screen.findByRole('heading', { level: 1, name: 'Priya Sharma' });
    const original = api.fetchMock.getMockImplementation()!;
    api.fetchMock.mockImplementation(async (input, init) =>
      String(input).startsWith('https://s3.test/')
        ? new Response('<Error><Code>AccessDenied</Code></Error>', { status: 403 })
        : original(input, init),
    );
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await failTwice(1);
    expect(await within(item(1)).findByText('The video file could not be accessed (S3 refused the request: AccessDenied).')).toBeInTheDocument();
    expect(within(item(1)).getByRole('link', { name: 'Open video in a new tab' })).toHaveAttribute('href', expect.stringMatching(/^https:\/\/s3\.test\//));
  });

  it('explains an unsupported format (e.g. WebM in Safari)', async () => {
    const api = await openReport({ report: makeReport() });
    await screen.findByRole('heading', { level: 1, name: 'Priya Sharma' });
    const original = api.fetchMock.getMockImplementation()!;
    api.fetchMock.mockImplementation(async (input, init) =>
      String(input).startsWith('https://s3.test/') ? new Response('x', { status: 206 }) : original(input, init),
    );
    vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('');
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await failTwice(2);
    expect(await within(item(2)).findByText(/This browser cannot play video\/webm videos\. Please open the report in Chrome, Edge or Firefox\./)).toBeInTheDocument();
  });
});
