import { apiRequest } from './apiClient';
import type { CandidateReport, SharedResponse, ShareResult } from '../types/report';

/** Recruiter: full report for one candidate (fresh presigned video URLs on every call). */
export function getCandidateReport(candidateId: string): Promise<CandidateReport> {
  return apiRequest<CandidateReport>(`/candidates/${encodeURIComponent(candidateId)}/report`, { auth: true });
}

/** Recruiter: email a link to one response to a hiring manager. */
export function shareResponse(responseId: string, input: { candidateId: string; recipientEmail: string }): Promise<ShareResult> {
  return apiRequest<ShareResult>(`/responses/${encodeURIComponent(responseId)}/share`, {
    method: 'POST',
    body: input,
    auth: true,
  });
}

/** Public (hiring manager): the single shared response for a share link token. */
export function getSharedResponse(token: string): Promise<SharedResponse> {
  return apiRequest<SharedResponse>(`/shared-responses/${encodeURIComponent(token)}`);
}
