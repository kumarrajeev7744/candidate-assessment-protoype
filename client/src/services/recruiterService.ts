import { apiRequest } from './apiClient';
import type { CandidateListResponse, InvitationActionResult, Rejection } from '../types/recruiter';

/** Recruiter APIs. All calls send the admin JWT; a 401 ends the session (see AuthContext). */
export function listCandidates(params: { search?: string; page?: number; limit?: number }): Promise<CandidateListResponse> {
  const query = new URLSearchParams();
  if (params.search) query.set('search', params.search);
  if (params.page && params.page > 1) query.set('page', String(params.page));
  if (params.limit) query.set('limit', String(params.limit));
  const qs = query.toString();
  return apiRequest<CandidateListResponse>(`/invitations${qs ? `?${qs}` : ''}`, { auth: true });
}

export function createCandidateInvitation(input: { name: string; email: string }): Promise<InvitationActionResult> {
  return apiRequest<InvitationActionResult>('/invitations', { method: 'POST', body: input, auth: true });
}

export function resendInvitation(invitationId: string): Promise<InvitationActionResult> {
  return apiRequest<InvitationActionResult>(`/invitations/${encodeURIComponent(invitationId)}/resend`, {
    method: 'POST',
    auth: true,
  });
}

export function resendConfirmationEmail(invitationId: string): Promise<InvitationActionResult> {
  return apiRequest<InvitationActionResult>(`/invitations/${encodeURIComponent(invitationId)}/resend-confirmation`, {
    method: 'POST',
    auth: true,
  });
}

export function rejectCandidate(candidateId: string, reason: string): Promise<{ candidateId: string; rejection: Rejection }> {
  return apiRequest(`/candidates/${encodeURIComponent(candidateId)}/reject`, { method: 'POST', body: { reason }, auth: true });
}

export function undoRejection(candidateId: string): Promise<{ candidateId: string; rejection: null }> {
  return apiRequest(`/candidates/${encodeURIComponent(candidateId)}/rejection`, { method: 'DELETE', auth: true });
}
