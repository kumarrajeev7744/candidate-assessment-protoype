import type { NextFunction, Request, Response } from 'express';
import type { ZodType } from 'zod';
import { AppError } from '../utils/AppError.js';

export class RequestValidationError extends AppError {
  constructor(details: Record<string, string>) {
    super(400, 'Validation failed', 'VALIDATION_ERROR', details);
  }
}

/** Validates (and replaces) req.body with the parsed result of a Zod schema. */
export function validateBody(schema: ZodType) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body ?? {});
    if (!result.success) {
      const details: Record<string, string> = {};
      for (const issue of result.error.issues) {
        const key = issue.path.join('.') || 'body';
        details[key] ??= issue.message;
      }
      next(new RequestValidationError(details));
      return;
    }
    req.body = result.data;
    next();
  };
}
