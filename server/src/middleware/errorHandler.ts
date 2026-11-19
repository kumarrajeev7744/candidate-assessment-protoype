import type { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { AppError } from '../utils/AppError.js';
import { logger } from '../utils/logger.js';
import { RequestValidationError } from './validateBody.js';

interface ErrorBody {
  error: { code: string; message: string; details?: unknown };
}

function isBodyParserError(err: unknown): err is { status: number; type: string } {
  return typeof err === 'object' && err !== null && 'type' in err && 'status' in err;
}

function isDuplicateKeyError(err: unknown): err is { code: 11000; keyValue?: Record<string, unknown> } {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 11000;
}

/** Converts known errors into a status code + client-safe body. */
export function toErrorResponse(err: unknown): { status: number; body: ErrorBody } {
  if (err instanceof RequestValidationError) {
    return {
      status: 400,
      body: { error: { code: err.code, message: err.message, details: err.details } },
    };
  }
  if (err instanceof AppError) {
    const error = { code: err.code, message: err.message, ...(err.details !== undefined ? { details: err.details } : {}) };
    return { status: err.statusCode, body: { error } };
  }
  if (isBodyParserError(err) && err.type === 'entity.parse.failed') {
    return { status: 400, body: { error: { code: 'INVALID_JSON', message: 'Malformed JSON body' } } };
  }
  if (err instanceof mongoose.Error.ValidationError) {
    const details = Object.fromEntries(
      Object.entries(err.errors).map(([path, e]) => [path, e.message]),
    );
    return {
      status: 400,
      body: { error: { code: 'VALIDATION_ERROR', message: 'Validation failed', details } },
    };
  }
  if (err instanceof mongoose.Error.CastError) {
    return {
      status: 400,
      body: { error: { code: 'INVALID_ID', message: `Invalid value for ${err.path}` } },
    };
  }
  if (isDuplicateKeyError(err)) {
    const fields = Object.keys(err.keyValue ?? {}).join(', ') || 'field';
    return {
      status: 409,
      body: { error: { code: 'DUPLICATE', message: `A record with this ${fields} already exists` } },
    };
  }
  return {
    status: 500,
    body: { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
  };
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response<ErrorBody>,
  // Express identifies error handlers by their 4-argument signature.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
): void {
  const { status, body } = toErrorResponse(err);
  // Expected application errors (AppError, e.g. a failed email = 502) are logged where they occur.
  if (status >= 500 && !(err instanceof AppError)) {
    logger.error('Unhandled error', {
      error: String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
  }
  res.status(status).json(body);
}
