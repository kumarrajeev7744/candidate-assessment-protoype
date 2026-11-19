export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(value: string): boolean {
  return EMAIL_PATTERN.test(value.trim());
}

export interface CandidateFieldErrors {
  name?: string;
  email?: string;
}

/** Mirrors the backend rules for creating a candidate (name 1–200 chars without < >, valid email). */
export function validateCandidateInput(name: string, email: string): CandidateFieldErrors {
  const errors: CandidateFieldErrors = {};
  const trimmedName = name.trim();
  if (!trimmedName) errors.name = 'Name is required.';
  else if (trimmedName.length > 200) errors.name = 'Name must be at most 200 characters.';
  else if (/[<>]/.test(trimmedName)) errors.name = 'Name contains invalid characters.';
  const trimmedEmail = email.trim();
  if (!trimmedEmail) errors.email = 'Email is required.';
  else if (trimmedEmail.length > 254 || !isValidEmail(trimmedEmail)) errors.email = 'Enter a valid email address.';
  return errors;
}
