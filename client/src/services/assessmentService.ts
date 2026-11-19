import { apiRequest } from './apiClient';
import type { AssessmentData, SavedResponse, StartAssessmentResult } from '../types/assessment';

export function fetchAssessment(token: string): Promise<AssessmentData> {
  return apiRequest<AssessmentData>('/assessment', { assessmentToken: token });
}

export function startAssessment(token: string): Promise<StartAssessmentResult> {
  return apiRequest<StartAssessmentResult>('/assessment/start', { method: 'POST', assessmentToken: token });
}

export async function saveWrittenAnswer(token: string, questionId: string, writtenAnswer: string): Promise<SavedResponse> {
  const { response } = await apiRequest<{ response: SavedResponse }>(
    `/assessment/questions/${encodeURIComponent(questionId)}/response`,
    { method: 'PUT', body: { writtenAnswer }, assessmentToken: token, keepalive: true },
  );
  return response;
}
