import { API_BASE_URL } from '../utils/config';
import { getStoredSession } from '../utils/tokenStorage';

/** Error thrown for any failed API call. status 0 means the server could not be reached. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Attach the stored admin JWT and treat 401 responses as an expired session. */
  auth?: boolean;
  /** Candidate invitation token, sent as X-Assessment-Token (separate from recruiter auth). */
  assessmentToken?: string;
  /** Let the request finish even if the page is being closed (small bodies only). */
  keepalive?: boolean;
}

type UnauthorizedHandler = () => void;
let unauthorizedHandler: UnauthorizedHandler | null = null;

/** Registered by AuthContext so any authenticated call returning 401 ends the session. */
export function setUnauthorizedHandler(handler: UnauthorizedHandler | null): void {
  unauthorizedHandler = handler;
}

interface ErrorPayload {
  error?: { code?: string; message?: string; details?: unknown };
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.auth) {
    const session = getStoredSession();
    if (session) headers.Authorization = `Bearer ${session.token}`;
  }
  if (options.assessmentToken) headers['X-Assessment-Token'] = options.assessmentToken;

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      keepalive: options.keepalive,
    });
  } catch {
    throw new ApiError(
      0,
      'NETWORK_ERROR',
      'Unable to reach the server. Please check your connection and try again.',
    );
  }

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const error = (payload as ErrorPayload | null)?.error;
    if (response.status === 401 && options.auth) unauthorizedHandler?.();
    throw new ApiError(
      response.status,
      error?.code ?? 'HTTP_ERROR',
      error?.message ?? `Request failed (${response.status})`,
      error?.details,
    );
  }
  return payload as T;
}
