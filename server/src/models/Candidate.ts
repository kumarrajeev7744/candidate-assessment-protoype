import { Schema, model, type HydratedDocument } from 'mongoose';
import { EMAIL_REGEX, MAX_EMAIL_LENGTH } from '../utils/validation.js';

export interface ICandidate {
  name: string;
  email: string;
  createdAt: Date;
  updatedAt: Date;
}

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
  },
  { timestamps: true },
);

// Supports dashboard search by name.
candidateSchema.index({ name: 1 });

export const Candidate = model<ICandidate>('Candidate', candidateSchema);
export type CandidateDocument = HydratedDocument<ICandidate>;
