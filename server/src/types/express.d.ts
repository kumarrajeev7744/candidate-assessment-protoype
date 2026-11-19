import type { AuthenticatedAdmin } from './auth.js';

declare global {
  namespace Express {
    interface Request {
      /** Set by the requireAuth middleware. */
      admin?: AuthenticatedAdmin;
    }
  }
}

export {};
