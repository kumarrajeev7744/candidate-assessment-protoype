import { apiRequest } from './apiClient';
import type { Admin, LoginResponse } from '../types/auth';

export function login(email: string, password: string): Promise<LoginResponse> {
  return apiRequest<LoginResponse>('/auth/login', { method: 'POST', body: { email, password } });
}

export async function fetchCurrentAdmin(): Promise<Admin> {
  const { admin } = await apiRequest<{ admin: Admin }>('/auth/me', { auth: true });
  return admin;
}

export async function logout(): Promise<void> {
  await apiRequest<{ message: string }>('/auth/logout', { method: 'POST' });
}
