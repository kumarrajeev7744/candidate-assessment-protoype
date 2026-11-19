export type InvitationStatus = 'Invited' | 'In Progress' | 'Completed';

export interface InvitationValidity {
  valid: true;
  status: InvitationStatus;
  expiresAt: string;
}
