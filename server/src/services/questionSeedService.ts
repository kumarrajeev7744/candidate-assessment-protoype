import { Question, TOTAL_QUESTIONS } from '../models/index.js';
import type { QuestionSeed } from '../seed/questionSeedData.js';

export interface SeedResult {
  inserted: number;
  updated: number;
  unchanged: number;
}

/** Ensures the seed list is exactly questions 1..10 with non-empty text. */
export function validateQuestionSeeds(seeds: QuestionSeed[]): void {
  if (seeds.length !== TOTAL_QUESTIONS) {
    throw new Error(`Expected exactly ${TOTAL_QUESTIONS} questions, got ${seeds.length}`);
  }
  const numbers = seeds.map((s) => s.questionNumber).sort((a, b) => a - b);
  numbers.forEach((n, i) => {
    if (n !== i + 1) throw new Error(`Question numbers must be 1..${TOTAL_QUESTIONS} without gaps or duplicates`);
  });
  seeds.forEach((s) => {
    if (!s.questionText.trim()) throw new Error(`Question ${s.questionNumber} has empty text`);
  });
}

/**
 * Idempotently upserts the fixed questions by questionNumber.
 * Existing records are updated (text + active flag); nothing is ever deleted.
 */
export async function seedQuestions(seeds: QuestionSeed[]): Promise<SeedResult> {
  validateQuestionSeeds(seeds);
  const result: SeedResult = { inserted: 0, updated: 0, unchanged: 0 };

  for (const seed of seeds) {
    const existing = await Question.findOne({ questionNumber: seed.questionNumber });
    if (!existing) {
      await Question.create({ ...seed, questionText: seed.questionText.trim(), isActive: true });
      result.inserted += 1;
      continue;
    }
    existing.questionText = seed.questionText.trim();
    existing.isActive = true;
    if (existing.isModified()) {
      await existing.save();
      result.updated += 1;
    } else {
      result.unchanged += 1;
    }
  }
  return result;
}
