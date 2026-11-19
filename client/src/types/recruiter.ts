import type { InvitationStatus } from './invitation';

export type DeliveryStatus = 'Pending' | 'Sent' | 'Failed';

export interface CandidateListItem {
  id: string;
  candidate: { id: string; name: string; email: string };
  status: InvitationStatus;
  invitedAt: string;
  expiresAt: string;
  completedAt: string | null;
  isExpired: boolean;
  emailStatus: DeliveryStatus;
  confirmationEmailStatus: DeliveryStatus | null;
  confirmationEmailSentAt: string | null;
  canResendInvitation: boolean;
  canResendConfirmation: boolean;
}

export interface CandidateListResponse {
  items: CandidateListItem[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
  search: string;
}

export interface InvitationActionResult {
  candidate: { id: string; name: string; email: string; createdAt: string };
  invitation: { id: string; status: InvitationStatus; emailStatus: DeliveryStatus; expiresAt: string };
  email: { sent: boolean; error?: string };
}
