import bcrypt from 'bcryptjs';
import { Admin } from '../models/index.js';
import { AppError } from '../utils/AppError.js';
import { signAdminToken } from '../utils/jwt.js';
import type { AuthenticatedAdmin } from '../types/auth.js';

export const BCRYPT_COST = 12;

// Compared against when the email is unknown, so response time does not reveal valid emails.
const DUMMY_HASH = bcrypt.hashSync('timing-equalization-placeholder', BCRYPT_COST);

export interface LoginResult {
  token: string;
  expiresAt: string;
  admin: AuthenticatedAdmin;
}

const invalidCredentials = () => new AppError(401, 'Invalid email or password', 'INVALID_CREDENTIALS');

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST);
}

export async function login(email: string, password: string): Promise<LoginResult> {
  const admin = await Admin.findOne({ email: email.toLowerCase() }).select('+passwordHash');
  const passwordOk = await bcrypt.compare(password, admin?.passwordHash ?? DUMMY_HASH);
  if (!admin || !passwordOk) throw invalidCredentials();

  const identity: AuthenticatedAdmin = { id: admin.id as string, email: admin.email };
  const { token, expiresAt } = signAdminToken(identity);
  return { token, expiresAt: expiresAt.toISOString(), admin: identity };
}

/** Returns the admin's public profile, or 401 if the account no longer exists. */
export async function getAdminProfile(adminId: string) {
  const admin = await Admin.findById(adminId);
  if (!admin) throw new AppError(401, 'Account not found', 'UNAUTHORIZED');
  return { id: admin.id as string, email: admin.email, createdAt: admin.createdAt.toISOString() };
}
