import { describe, it, expect } from 'vitest';
import mongoose from 'mongoose';
import { toErrorResponse } from '../src/middleware/errorHandler.js';
import { AppError } from '../src/utils/AppError.js';
import { Candidate } from '../src/models/index.js';

describe('toErrorResponse', () => {
  it('maps AppError to its status and code', () => {
    expect(toErrorResponse(new AppError(403, 'Nope', 'FORBIDDEN'))).toEqual({
      status: 403,
      body: { error: { code: 'FORBIDDEN', message: 'Nope' } },
    });
  });

  it('maps Mongoose validation errors to 400 with field details', async () => {
    const err = await new Candidate({ email: 'bad' }).validate().catch((e: unknown) => e);
    const { status, body } = toErrorResponse(err);
    expect(status).toBe(400);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details).toEqual({ name: 'Name is required', email: 'Email is invalid' });
  });

  it('maps cast errors to 400', () => {
    const err = new mongoose.Error.CastError('ObjectId', 'abc', 'candidateId');
    expect(toErrorResponse(err)).toMatchObject({ status: 400, body: { error: { code: 'INVALID_ID' } } });
  });

  it('maps duplicate key errors to 409', () => {
    const err = Object.assign(new Error('E11000'), { code: 11000, keyValue: { email: 'a@b.com' } });
    expect(toErrorResponse(err)).toEqual({
      status: 409,
      body: { error: { code: 'DUPLICATE', message: 'A record with this email already exists' } },
    });
  });

  it('hides unknown errors behind a generic 500', () => {
    expect(toErrorResponse(new Error('db password leaked'))).toEqual({
      status: 500,
      body: { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
    });
  });
});
