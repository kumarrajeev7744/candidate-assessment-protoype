/** Operational error with an HTTP status code, safe to expose to clients. */
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code: string = 'ERROR',
    /** Optional structured, client-safe details (e.g. which questions are incomplete). */
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}
