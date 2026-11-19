import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { AuthProvider } from '../../src/context/AuthContext';
import { AppRoutes } from '../../src/routes/AppRoutes';

export function renderApp(path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </MemoryRouter>,
  );
}

/** Responses for requests most tests do not care about (e.g. the dashboard's candidate list). */
const DEFAULT_ROUTES: Record<string, Handler> = {
  'GET /invitations': () => ({
    status: 200,
    body: { items: [], pagination: { page: 1, limit: 50, total: 0, totalPages: 1 }, search: '' },
  }),
};

type Handler = (init: RequestInit | undefined) => { status: number; body: unknown } | Promise<{ status: number; body: unknown }>;

/**
 * Replaces global fetch with a simple router keyed by "METHOD /path" (path relative to the API base URL).
 * Unmatched requests fail the test loudly.
 */
export function mockApi(routes: Record<string, Handler>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const path = url.pathname.replace(/^\/api/, '');
    const key = `${init?.method ?? 'GET'} ${path}`;
    const handler = routes[key] ?? DEFAULT_ROUTES[key];
    if (!handler) throw new Error(`Unexpected request: ${key}`);
    const { status, body } = await handler(init);
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

export const ADMIN = { id: 'admin-1', email: 'recruiter@example.com', createdAt: '2026-01-01T00:00:00.000Z' };

export function futureIso(ms = 60 * 60 * 1000): string {
  return new Date(Date.now() + ms).toISOString();
}
