import { Schema, model, type HydratedDocument } from 'mongoose';
import { EMAIL_REGEX, MAX_EMAIL_LENGTH } from '../utils/validation.js';

export interface IAdmin {
  email: string;
  passwordHash: string;
  createdAt: Date;
  updatedAt: Date;
}

const adminSchema = new Schema<IAdmin>(
  {
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      trim: true,
      lowercase: true,
      maxlength: MAX_EMAIL_LENGTH,
      match: [EMAIL_REGEX, 'Email is invalid'],
    },
    // bcrypt hash; excluded from queries unless explicitly selected with '+passwordHash'.
    passwordHash: { type: String, required: [true, 'Password hash is required'], select: false },
  },
  { timestamps: true },
);

export const Admin = model<IAdmin>('Admin', adminSchema);
export type AdminDocument = HydratedDocument<IAdmin>;
