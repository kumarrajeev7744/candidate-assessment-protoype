/**
 * Base URL of the REST API, baked in at build time from VITE_API_BASE_URL.
 * The localhost fallback exists only in the dev server; production builds refuse to run without the
 * variable (see vite.config.ts), so no localhost URL ends up in the deployed bundle.
 */
export const API_BASE_URL: string =
  import.meta.env.VITE_API_BASE_URL || (import.meta.env.DEV ? 'http://localhost:4000/api' : '');
