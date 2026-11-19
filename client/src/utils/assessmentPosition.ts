/** Remembers the candidate's last screen per invitation so reopening the email link resumes there. */
export type AssessmentPosition = number | 'review';

/** Small non-cryptographic hash so the raw token is not used as a storage key. */
function storageKey(token: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < token.length; i++) {
    hash ^= token.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `candidateAssessment.position.${(hash >>> 0).toString(16)}`;
}

export function getStoredPosition(token: string): AssessmentPosition | null {
  try {
    const raw = localStorage.getItem(storageKey(token));
    if (raw === 'review') return 'review';
    const n = Number(raw);
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

export function storePosition(token: string, position: AssessmentPosition): void {
  try {
    localStorage.setItem(storageKey(token), String(position));
  } catch {
    // Storage unavailable: resume falls back to the first unanswered question.
  }
}
