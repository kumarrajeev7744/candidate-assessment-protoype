import type { AssessmentData } from '../../types/assessment';
import { getStoredPosition } from '../../utils/assessmentPosition';

/** Path (relative to /assessment/:token) where a returning candidate should continue. */
export function resumePath(token: string, data: AssessmentData, drafts: Record<string, string>): string {
  const total = data.questions.length;
  const stored = getStoredPosition(token);
  if (stored === 'review') return 'review';
  if (typeof stored === 'number' && stored <= total) return `questions/${stored}`;
  const firstUnanswered = data.questions.findIndex((q) => !(drafts[q.id] ?? '').trim());
  return firstUnanswered === -1 ? 'review' : `questions/${firstUnanswered + 1}`;
}
