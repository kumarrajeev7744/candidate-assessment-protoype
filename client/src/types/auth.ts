export interface Admin {
  id: string;
  email: string;
  createdAt?: string;
}

export interface LoginResponse {
  token: string;
  expiresAt: string;
  admin: Admin;
}

export interface StoredSession {
  token: string;
  expiresAt: string;
}
