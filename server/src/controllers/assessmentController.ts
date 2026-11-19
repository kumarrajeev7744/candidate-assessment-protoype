import type { Request, Response } from 'express';
import * as assessmentService from '../services/assessmentService.js';
import * as videoService from '../services/videoService.js';
import type {
  SaveResponseInput,
  VideoConfirmInput,
  VideoUploadUrlInput,
} from '../validation/assessmentSchemas.js';

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

export async function videoUploadUrlHandler(req: Request<{ questionId: string }>, res: Response): Promise<void> {
  const result = await videoService.createVideoUploadUrl(
    req.candidateSession!,
    req.params.questionId,
    req.body as VideoUploadUrlInput,
  );
  res.set('Cache-Control', 'no-store');
  res.status(200).json(result);
}

export async function videoConfirmHandler(req: Request<{ questionId: string }>, res: Response): Promise<void> {
  const { objectKey } = req.body as VideoConfirmInput;
  const response = await videoService.confirmVideoUpload(req.candidateSession!, req.params.questionId, objectKey);
  res.status(200).json({ response });
}

export async function videoUrlHandler(req: Request<{ questionId: string }>, res: Response): Promise<void> {
  const result = await videoService.getVideoPlaybackUrl(req.candidateSession!, req.params.questionId);
  res.set('Cache-Control', 'no-store');
  res.status(200).json(result);
}
