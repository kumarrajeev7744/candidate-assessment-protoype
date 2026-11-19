import { Schema, model, type HydratedDocument, type Types } from 'mongoose';
import { addDays } from '../utils/dates.js';
import { EMAIL_REGEX, MAX_EMAIL_LENGTH } from '../utils/validation.js';
import { EMAIL_STATUSES, SHARE_LINK_EXPIRY_DAYS, type EmailStatus } from './constants.js';

export interface IShareLink {
  responseId: Types.ObjectId;
  /** SHA-256 hash of the share token. The plaintext token is never stored. */
  tokenHash: string;
  recipientEmail: string;
  createdAt: Date;
  expiresAt: Date;
  /** Delivery of the share email. Only links whose email was Sent can be opened. */
  emailStatus: EmailStatus;
  emailSentAt?: Date;
  emailLastAttemptAt?: Date;
}

const shareLinkSchema = new Schema<IShareLink>(
  {
    responseId: {
      type: Schema.Types.ObjectId,
      ref: 'Response',
      required: [true, 'Response is required'],
      index: true,
    },
    tokenHash: {
      type: String,
      required: [true, 'Token hash is required'],
      unique: true,
      match: [/^[a-f0-9]{64}$/, 'Token hash must be a SHA-256 hex digest'],
    },
    recipientEmail: {
      type: String,
      required: [true, 'Recipient email is required'],
      trim: true,
      lowercase: true,
      maxlength: MAX_EMAIL_LENGTH,
      match: [EMAIL_REGEX, 'Recipient email is invalid'],
    },
    emailStatus: { type: String, enum: EMAIL_STATUSES, default: 'Pending', required: true },
    emailSentAt: { type: Date },
    emailLastAttemptAt: { type: Date },
    // Expired links are kept (no TTL index); expiry is checked when the link is opened.
    expiresAt: {
      type: Date,
      required: true,
      default: () => addDays(new Date(), SHARE_LINK_EXPIRY_DAYS),
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

export const ShareLink = model<IShareLink>('ShareLink', shareLinkSchema);
export type ShareLinkDocument = HydratedDocument<IShareLink>;
