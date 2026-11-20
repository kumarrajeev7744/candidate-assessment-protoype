import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import * as authService from '../services/authService';
import { setUnauthorizedHandler } from '../services/apiClient';
import { broadcastLogout, onLogoutInOtherTab } from '../utils/authBroadcast';
import {
  clearStoredSession,
  getStoredSession,
  isSessionExpired,
  storeSession,
} from '../utils/tokenStorage';
import type { Admin } from '../types/auth';

export type AuthStatus = 'checking' | 'authenticated' | 'unauthenticated';

export const SESSION_EXPIRED_MESSAGE = 'Your session has expired. Please log in again.';
export const LOGGED_OUT_ELSEWHERE_MESSAGE = 'You have been signed out in another tab.';

interface AuthState {
  status: AuthStatus;
  admin: Admin | null;
  /** Shown on the login page after an automatic sign-out. */
  notice: string | null;
}

export interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function initialState(): AuthState {
  const session = getStoredSession();
  if (!session) return { status: 'unauthenticated', admin: null, notice: null };
  if (isSessionExpired(session)) {
    clearStoredSession();
    return { status: 'unauthenticated', admin: null, notice: SESSION_EXPIRED_MESSAGE };
  }
  return { status: 'checking', admin: null, notice: null };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(initialState);

  const endSession = useCallback((notice: string | null) => {
    clearStoredSession();
    setState({ status: 'unauthenticated', admin: null, notice });
  }, []);

  // Any authenticated API call that returns 401 ends the session.
  useEffect(() => {
    setUnauthorizedHandler(() => endSession(SESSION_EXPIRED_MESSAGE));
    return () => setUnauthorizedHandler(null);
  }, [endSession]);

  // On page load, validate a restored token with the backend.
  useEffect(() => {
    if (state.status !== 'checking') return;
    let cancelled = false;
    authService
      .fetchCurrentAdmin()
      .then((admin) => {
        if (!cancelled) setState({ status: 'authenticated', admin, notice: null });
      })
      .catch(() => {
        if (!cancelled) endSession(SESSION_EXPIRED_MESSAGE);
      });
    return () => {
      cancelled = true;
    };
  }, [state.status, endSession]);

  // Sign out automatically when the token expires.
  useEffect(() => {
    if (state.status !== 'authenticated') return;
    const session = getStoredSession();
    if (!session) return;
    const remainingMs = Date.parse(session.expiresAt) - Date.now();
    const timer = window.setTimeout(
      () => endSession(SESSION_EXPIRED_MESSAGE),
      Math.max(0, Math.min(remainingMs, 2_147_483_647)),
    );
    return () => window.clearTimeout(timer);
  }, [state.status, endSession]);

  const login = useCallback(async (email: string, password: string) => {
    const result = await authService.login(email, password);
    storeSession({ token: result.token, expiresAt: result.expiresAt });
    setState({ status: 'authenticated', admin: result.admin, notice: null });
  }, []);

  const logout = useCallback(() => {
    authService.logout().catch(() => undefined); // best effort; the token is discarded locally
    endSession(null);
    broadcastLogout(); // other open tabs end their copy of the session too
  }, [endSession]);

  // A logout in another tab ends the session here as well.
  useEffect(
    () =>
      onLogoutInOtherTab(() => {
        if (getStoredSession()) endSession(LOGGED_OUT_ELSEWHERE_MESSAGE);
      }),
    [endSession],
  );

  const value = useMemo<AuthContextValue>(() => ({ ...state, login, logout }), [state, login, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
