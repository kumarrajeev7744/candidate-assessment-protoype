/**
 * Cross-tab "logged out" signal. Each tab keeps its own copy of the admin session
 * (sessionStorage), so a logout must be announced to the other open tabs.
 * Uses BroadcastChannel, with the localStorage "storage" event as a fallback.
 * The message carries no token or other secret.
 */
const CHANNEL_NAME = 'candidate-assessment-auth';
const STORAGE_KEY = 'candidateAssessment.authEvent';

type AuthEvent = { type: 'logout'; at: number };

function isLogout(value: unknown): value is AuthEvent {
  return typeof value === 'object' && value !== null && (value as AuthEvent).type === 'logout';
}

export function broadcastLogout(): void {
  const event: AuthEvent = { type: 'logout', at: Date.now() };
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel(CHANNEL_NAME);
      channel.postMessage(event);
      channel.close();
    }
  } catch {
    // ignore: the storage event below still reaches other tabs
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(event));
  } catch {
    // storage unavailable (e.g. privacy mode)
  }
}

/** Calls `onLogout` when another tab logs out. Returns an unsubscribe function. */
export function onLogoutInOtherTab(onLogout: () => void): () => void {
  let channel: BroadcastChannel | null = null;
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      channel = new BroadcastChannel(CHANNEL_NAME);
      channel.onmessage = (message: MessageEvent) => {
        if (isLogout(message.data)) onLogout();
      };
    }
  } catch {
    channel = null;
  }
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY || !event.newValue) return;
    try {
      if (isLogout(JSON.parse(event.newValue))) onLogout();
    } catch {
      // ignore malformed values
    }
  };
  window.addEventListener('storage', onStorage);
  return () => {
    channel?.close();
    window.removeEventListener('storage', onStorage);
  };
}
