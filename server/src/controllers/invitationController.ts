import type { Request, Response } from 'express';
import * as invitationService from '../services/invitationService.js';
import { listInvitationsQuerySchema, type CreateInvitationInput } from '../validation/invitationSchemas.js';
import { listInvitations } from '../services/invitationListService.js';
import { RequestValidationError } from '../middleware/validateBody.js';

export async function createInvitationHandler(req: Request, res: Response): Promise<void> {
  const result = await invitationService.createInvitation(req.body as CreateInvitationInput);
  res.status(201).json(result);
}

export async function resendInvitationHandler(req: Request<{ id: string }>, res: Response): Promise<void> {
  const result = await invitationService.resendInvitation(req.params.id);
  res.status(200).json(result);
}

export async function validateInvitationHandler(req: Request<{ token: string }>, res: Response): Promise<void> {
  const result = await invitationService.validateInvitationToken(req.params.token);
  res.set('Cache-Control', 'no-store');
  res.status(200).json(result);
}

export async function resendConfirmationHandler(req: Request<{ id: string }>, res: Response): Promise<void> {
  const result = await invitationService.resendConfirmationEmail(req.params.id);
  res.status(200).json(result);
}

export async function listInvitationsHandler(req: Request, res: Response): Promise<void> {
  const parsed = listInvitationsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    const details: Record<string, string> = {};
    for (const issue of parsed.error.issues) details[issue.path.join('.') || 'query'] ??= issue.message;
    throw new RequestValidationError(details);
  }
  res.set('Cache-Control', 'no-store');
  res.status(200).json(await listInvitations(parsed.data));
}
