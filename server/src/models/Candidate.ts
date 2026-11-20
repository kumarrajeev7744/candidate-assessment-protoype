import { Schema, model, type HydratedDocument } from 'mongoose';
import { EMAIL_REGEX, MAX_EMAIL_LENGTH } from '../utils/validation.js';

export const REJECTION_REASON_MAX_LENGTH = 500;

/** Recruiter decision to reject the candidate (separate from the assessment status). */
export interface ICandidateRejection {
  reason: string;
  rejectedAt: Date;
  /** Email of the recruiter who rejected the candidate. */
  rejectedBy: string;
}

export interface ICandidate {
  name: string;
  email: string;
  rejection?: ICandidateRejection;
  createdAt: Date;
  updatedAt: Date;
}

const rejectionSchema = new Schema<ICandidateRejection>(
  {
    reason: {
      type: String,
      required: [true, 'Rejection reason is required'],
      trim: true,
      minlength: [1, 'Rejection reason is required'],
      maxlength: [REJECTION_REASON_MAX_LENGTH, `Rejection reason cannot exceed ${REJECTION_REASON_MAX_LENGTH} characters`],
    },
    rejectedAt: { type: Date, required: true },
    rejectedBy: { type: String, required: true, trim: true, maxlength: MAX_EMAIL_LENGTH },
  },
  { _id: false },
);

const candidateSchema = new Schema<ICandidate>(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
      minlength: 1,
      maxlength: 200,
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      // One candidate record per email address (one invitation per candidate).
      unique: true,
      trim: true,
      lowercase: true,
      maxlength: MAX_EMAIL_LENGTH,
      match: [EMAIL_REGEX, 'Email is invalid'],
    },
    rejection: { type: rejectionSchema, required: false },
  },
  { timestamps: true },
);

// Supports dashboard search by name.
candidateSchema.index({ name: 1 });

export const Candidate = model<ICandidate>('Candidate', candidateSchema);
export type CandidateDocument = HydratedDocument<ICandidate>;
