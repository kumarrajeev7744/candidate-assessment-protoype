import type { StoredSession } from '../types/auth';

const STORAGE_KEY = 'candidateAssessment.adminSession';

/** Reads the admin session from sessionStorage (cleared when the browser tab closes). */
export function getStoredSession(): StoredSession | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredSession>;
    if (typeof parsed.token !== 'string' || typeof parsed.expiresAt !== 'string') return null;
    return { token: parsed.token, expiresAt: parsed.expiresAt };
  } catch {
    return null;
  }
}

export function storeSession(session: StoredSession): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Storage unavailable (e.g. privacy mode); the session simply won't survive a refresh.
  }
}

export function clearStoredSession(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function isSessionExpired(session: StoredSession, now: number = Date.now()): boolean {
  const expiresAt = Date.parse(session.expiresAt);
  return Number.isNaN(expiresAt) || expiresAt <= now;
}
