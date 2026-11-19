import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/AppError.js';
import { config } from '../config/env.js';

interface ErrorBody {
  error: { code: string; message: string };
}

function isBodyParserError(err: unknown): err is { status: number; type: string } {
  return typeof err === 'object' && err !== null && 'type' in err && 'status' in err;
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response<ErrorBody>,
  // Express identifies error handlers by their 4-argument signature.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({ error: { code: err.code, message: err.message } });
    return;
  }

  if (isBodyParserError(err) && err.type === 'entity.parse.failed') {
    res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Malformed JSON body' } });
    return;
  }

  if (config.nodeEnv !== 'test') {
    console.error(JSON.stringify({ level: 'error', message: 'Unhandled error', error: String(err), stack: err instanceof Error ? err.stack : undefined }));
  }
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
}
