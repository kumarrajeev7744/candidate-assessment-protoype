import type { Request, Response } from 'express';
import { getCandidateReport } from '../services/reportService.js';
import { getSharedContent, shareCandidateReport, shareResponse } from '../services/shareService.js';
import { deleteCandidate } from '../services/candidateDeletionService.js';
import type { ShareReportInput, ShareResponseInput } from '../validation/invitationSchemas.js';

export async function candidateReportHandler(req: Request<{ candidateId: string }>, res: Response): Promise<void> {
  res.set('Cache-Control', 'no-store');
  res.status(200).json(await getCandidateReport(req.params.candidateId));
}

export async function shareResponseHandler(req: Request<{ responseId: string }>, res: Response): Promise<void> {
  const result = await shareResponse(req.params.responseId, req.body as ShareResponseInput);
  res.status(201).json({ ...result, email: { sent: true } });
}

export async function sharedResponseHandler(req: Request<{ token: string }>, res: Response): Promise<void> {
  res.set('Cache-Control', 'no-store');
  res.status(200).json(await getSharedContent(req.params.token));
}

export async function shareReportHandler(req: Request<{ candidateId: string }>, res: Response): Promise<void> {
  const { recipientEmail } = req.body as ShareReportInput;
  const result = await shareCandidateReport(req.params.candidateId, recipientEmail);
  res.status(201).json({ ...result, email: { sent: true } });
}

export async function deleteCandidateHandler(req: Request<{ candidateId: string }>, res: Response): Promise<void> {
  res.status(200).json(await deleteCandidate(req.params.candidateId));
}
