import { apiRequest } from './apiClient';
import type { InvitationValidity } from '../types/invitation';

/** Public, read-only check of a candidate invitation link. */
export function validateInvitation(token: string): Promise<InvitationValidity> {
  return apiRequest<InvitationValidity>(`/invitations/validate/${encodeURIComponent(token)}`);
}
