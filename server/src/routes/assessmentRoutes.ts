import { Router } from 'express';
import {
  getAssessmentHandler,
  saveResponseHandler,
  startAssessmentHandler,
  videoConfirmHandler,
  videoUploadUrlHandler,
  videoUrlHandler,
} from '../controllers/assessmentController.js';
import { requireCandidate } from '../middleware/requireCandidate.js';
import { validateBody } from '../middleware/validateBody.js';
import { createPublicRateLimiter } from '../middleware/rateLimiters.js';
import { saveResponseSchema, videoConfirmSchema, videoUploadUrlSchema } from '../validation/assessmentSchemas.js';

/** Candidate-facing assessment API, authenticated by the invitation token (not the recruiter JWT). */
export function createAssessmentRouter(): Router {
  const router = Router();
  // Autosave sends frequent small requests; this only stops abuse.
  router.use(createPublicRateLimiter({ windowMs: 60_000, max: 300 }));
  router.use(requireCandidate);

  router.post('/start', startAssessmentHandler);
  router.get('/', getAssessmentHandler);
  router.put('/questions/:questionId/response', validateBody(saveResponseSchema), saveResponseHandler);
  router.post('/questions/:questionId/video-upload-url', validateBody(videoUploadUrlSchema), videoUploadUrlHandler);
  router.post('/questions/:questionId/video-confirm', validateBody(videoConfirmSchema), videoConfirmHandler);
  router.get('/questions/:questionId/video-url', videoUrlHandler);
  return router;
}
