import { getStoredPosition } from '../../utils/assessmentPosition';

/**
 * Path (relative to /assessment/:token) where a returning candidate should continue:
 * their last screen on this device, but never beyond the first incomplete question.
 */
export function resumePath(token: string, firstIncompleteNumber: number | null): string {
  const stored = getStoredPosition(token);
  if (firstIncompleteNumber === null) {
    return typeof stored === 'number' ? `questions/${stored}` : 'review';
  }
  if (typeof stored === 'number' && stored <= firstIncompleteNumber) return `questions/${stored}`;
  return `questions/${firstIncompleteNumber}`;
}
