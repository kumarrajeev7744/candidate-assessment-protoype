import type { Request, Response } from 'express';
import * as invitationService from '../services/invitationService.js';
import type { CreateInvitationInput } from '../validation/invitationSchemas.js';

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
