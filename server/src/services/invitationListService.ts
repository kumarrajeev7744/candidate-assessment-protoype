import type { PipelineStage, Types } from 'mongoose';
import { Invitation, type EmailStatus, type InvitationStatus } from '../models/index.js';
import { isExpired } from '../utils/dates.js';
import type { ListInvitationsQuery } from '../validation/invitationSchemas.js';

/** One dashboard row. Contains no tokens, hashes or storage keys. */
export interface InvitationListItem {
  id: string;
  candidate: { id: string; name: string; email: string };
  status: InvitationStatus;
  invitedAt: string;
  expiresAt: string;
  completedAt: string | null;
  isExpired: boolean;
  emailStatus: EmailStatus;
  confirmationEmailStatus: EmailStatus | null;
  confirmationEmailSentAt: string | null;
  canResendInvitation: boolean;
  canResendConfirmation: boolean;
}

export interface InvitationListResult {
  items: InvitationListItem[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
  search: string;
}

interface Row {
  _id: Types.ObjectId;
  status: InvitationStatus;
  invitedAt: Date;
  expiresAt: Date;
  completedAt?: Date;
  emailStatus: EmailStatus;
  confirmationEmailStatus?: EmailStatus;
  confirmationEmailSentAt?: Date;
  candidate: { _id: Types.ObjectId; name: string; email: string };
}

/** Escapes user input for use inside a RegExp (search is a literal "contains" match). */
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function toItem(row: Row): InvitationListItem {
  const completed = row.status === 'Completed';
  return {
    id: row._id.toString(),
    candidate: { id: row.candidate._id.toString(), name: row.candidate.name, email: row.candidate.email },
    status: row.status,
    invitedAt: row.invitedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    isExpired: !completed && isExpired(row.expiresAt),
    emailStatus: row.emailStatus,
    confirmationEmailStatus: row.confirmationEmailStatus ?? null,
    confirmationEmailSentAt: row.confirmationEmailSentAt ? row.confirmationEmailSentAt.toISOString() : null,
    canResendInvitation: !completed,
    canResendConfirmation: completed && row.confirmationEmailStatus !== 'Sent',
  };
}

/**
 * Recruiter candidate list: invitations joined with their candidate, newest first,
 * with an optional case-insensitive "contains" search on name or email.
 */
export async function listInvitations(query: ListInvitationsQuery): Promise<InvitationListResult> {
  const { search, page, limit } = query;
  const pipeline: PipelineStage[] = [
    { $lookup: { from: 'candidates', localField: 'candidateId', foreignField: '_id', as: 'candidate' } },
    { $unwind: '$candidate' },
  ];
  if (search) {
    const pattern = new RegExp(escapeRegExp(search), 'i');
    pipeline.push({ $match: { $or: [{ 'candidate.name': pattern }, { 'candidate.email': pattern }] } });
  }
  pipeline.push(
    { $sort: { invitedAt: -1, _id: -1 } },
    {
      $facet: {
        items: [
          { $skip: (page - 1) * limit },
          { $limit: limit },
          {
            // Whitelist of fields: nothing sensitive (tokenHash, responseVersion, ...) leaves the database.
            $project: {
              status: 1,
              invitedAt: 1,
              expiresAt: 1,
              completedAt: 1,
              emailStatus: 1,
              confirmationEmailStatus: 1,
              confirmationEmailSentAt: 1,
              'candidate._id': 1,
              'candidate.name': 1,
              'candidate.email': 1,
            },
          },
        ],
        total: [{ $count: 'count' }],
      },
    },
  );

  const [result] = await Invitation.aggregate<{ items: Row[]; total: Array<{ count: number }> }>(pipeline);
  const total = result?.total[0]?.count ?? 0;
  return {
    items: (result?.items ?? []).map(toItem),
    pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    search,
  };
}
