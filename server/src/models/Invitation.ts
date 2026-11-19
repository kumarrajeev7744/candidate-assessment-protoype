import { Schema, model, type HydratedDocument, type Types } from 'mongoose';
import { addDays } from '../utils/dates.js';
import {
  EMAIL_STATUSES,
  INVITATION_EXPIRY_DAYS,
  INVITATION_STATUSES,
  type EmailStatus,
  type InvitationStatus,
} from './constants.js';

export interface IInvitation {
  candidateId: Types.ObjectId;
  /** SHA-256 hash of the invitation token. The plaintext token is never stored. */
  tokenHash: string;
  status: InvitationStatus;
  invitedAt: Date;
  expiresAt: Date;
  completedAt?: Date;
  emailStatus: EmailStatus;
  /** Delivery status of the submission confirmation email (set when the assessment is completed). */
  confirmationEmailStatus?: EmailStatus;
  confirmationEmailSentAt?: Date;
  confirmationEmailLastAttemptAt?: Date;
  /** Internal concurrency token: bumped by every response write and by submission (see responseLock). */
  responseVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

const SHA256_HEX = /^[a-f0-9]{64}$/;

const invitationSchema = new Schema<IInvitation>(
  {
    candidateId: {
      type: Schema.Types.ObjectId,
      ref: 'Candidate',
      required: [true, 'Candidate is required'],
      // One assessment invitation per candidate.
      unique: true,
    },
    tokenHash: {
      type: String,
      required: [true, 'Token hash is required'],
      unique: true,
      match: [SHA256_HEX, 'Token hash must be a SHA-256 hex digest'],
    },
    status: { type: String, enum: INVITATION_STATUSES, default: 'Invited', required: true },
    invitedAt: { type: Date, default: () => new Date(), required: true },
    // Expired invitations are kept for dashboard history: no TTL index.
    expiresAt: {
      type: Date,
      required: true,
      default: function (this: IInvitation) {
        return addDays(this.invitedAt ?? new Date(), INVITATION_EXPIRY_DAYS);
      },
    },
    completedAt: { type: Date },
    emailStatus: { type: String, enum: EMAIL_STATUSES, default: 'Pending', required: true },
    confirmationEmailStatus: { type: String, enum: EMAIL_STATUSES },
    confirmationEmailSentAt: { type: Date },
    confirmationEmailLastAttemptAt: { type: Date },
    responseVersion: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true },
);

invitationSchema.path('expiresAt').validate(function (this: IInvitation, value: Date) {
  return !this.invitedAt || value > this.invitedAt;
}, 'Expiry must be after the invitation date');

invitationSchema.path('completedAt').validate(function (this: IInvitation, value?: Date) {
  return value === undefined || value === null || this.status === 'Completed';
}, 'completedAt can only be set on a completed invitation');

export const Invitation = model<IInvitation>('Invitation', invitationSchema);
export type InvitationDocument = HydratedDocument<IInvitation>;
