import type { Request, Response } from 'express';
import * as assessmentService from '../services/assessmentService.js';
import type { SaveResponseInput } from '../validation/assessmentSchemas.js';

export async function startAssessmentHandler(req: Request, res: Response): Promise<void> {
  res.status(200).json(await assessmentService.startAssessment(req.candidateSession!));
}

export async function getAssessmentHandler(req: Request, res: Response): Promise<void> {
  res.set('Cache-Control', 'no-store');
  res.status(200).json(await assessmentService.getAssessment(req.candidateSession!));
}

export async function saveResponseHandler(req: Request<{ questionId: string }>, res: Response): Promise<void> {
  const { writtenAnswer } = req.body as SaveResponseInput;
  const response = await assessmentService.saveWrittenAnswer(
    req.candidateSession!,
    req.params.questionId,
    writtenAnswer,
  );
  res.status(200).json({ response });
}
