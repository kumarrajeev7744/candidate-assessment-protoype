import { apiRequest } from './apiClient';
import type { CandidateReport, SharedContent, ShareResult } from '../types/report';

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

/** Recruiter: email a link to the candidate's full assessment to a hiring manager. */
export function shareFullReport(candidateId: string, recipientEmail: string): Promise<ShareResult> {
  return apiRequest<ShareResult>(`/candidates/${encodeURIComponent(candidateId)}/share`, {
    method: 'POST',
    body: { recipientEmail },
    auth: true,
  });
}

/** Recruiter: permanently delete a candidate and all their data (database + stored videos). */
export function deleteCandidate(candidateId: string): Promise<{ deleted: Record<string, number> }> {
  return apiRequest<{ deleted: Record<string, number> }>(`/candidates/${encodeURIComponent(candidateId)}`, {
    method: 'DELETE',
    auth: true,
  });
}

/** Public (hiring manager): what a share link covers — one response or the full assessment. */
export function getSharedContent(token: string): Promise<SharedContent> {
  return apiRequest<SharedContent>(`/shared-responses/${encodeURIComponent(token)}`);
}
