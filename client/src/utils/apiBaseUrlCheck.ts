/**
 * Build-time check of VITE_API_BASE_URL (used by vite.config.ts for production builds).
 * The value is baked into the static bundle, so a missing or wrong value would ship a frontend
 * that talks to the wrong API.
 */
export interface ApiBaseUrlCheck {
  error?: string;
  warning?: string;
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export function checkApiBaseUrl(value: string | undefined): ApiBaseUrlCheck {
  if (!value?.trim()) {
    return {
      error:
        'VITE_API_BASE_URL is not set. Production builds need the public API URL, e.g. ' +
        'VITE_API_BASE_URL=https://<app-runner-service-url>/api npm run build:client',
    };
  }
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return { error: 'VITE_API_BASE_URL must be an absolute URL (https://…/api).' };
  }
  const local = LOCAL_HOSTS.has(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    return { error: 'VITE_API_BASE_URL must use https:// (plain http is only allowed for localhost).' };
  }
  if (local) {
    return { warning: 'VITE_API_BASE_URL points to localhost: this build only works on this machine. Do not deploy it.' };
  }
  if (!/\/api\/?$/.test(url.pathname)) {
    return { warning: 'VITE_API_BASE_URL does not end with /api; API routes are served under /api.' };
  }
  return {};
}
