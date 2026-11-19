import { describe, it, expect } from 'vitest';
import { useTestDatabase } from './helpers/db.js';
import { Question } from '../src/models/index.js';
import { questionSeedData, type QuestionSeed } from '../src/seed/questionSeedData.js';
import { seedQuestions, validateQuestionSeeds } from '../src/services/questionSeedService.js';

useTestDatabase();

describe('question seed data', () => {
  it('contains 10 clearly marked placeholder questions numbered 1..10', () => {
    expect(questionSeedData).toHaveLength(10);
    expect(questionSeedData.map((q) => q.questionNumber)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    for (const q of questionSeedData) expect(q.questionText).toMatch(/^\[PLACEHOLDER\]/);
  });

  it('rejects invalid seed lists', () => {
    expect(() => validateQuestionSeeds(questionSeedData.slice(0, 9))).toThrow(/exactly 10/);
    const dup = questionSeedData.map((q) => ({ ...q, questionNumber: q.questionNumber === 10 ? 9 : q.questionNumber }));
    expect(() => validateQuestionSeeds(dup)).toThrow(/without gaps or duplicates/);
    const blank = questionSeedData.map((q) => (q.questionNumber === 5 ? { ...q, questionText: '  ' } : q));
    expect(() => validateQuestionSeeds(blank)).toThrow(/Question 5 has empty text/);
  });
});

describe('seedQuestions', () => {
  it('creates exactly 10 active questions in order', async () => {
    const result = await seedQuestions(questionSeedData);
    expect(result).toEqual({ inserted: 10, updated: 0, unchanged: 0 });
    const questions = await Question.find({ isActive: true }).sort({ questionNumber: 1 });
    expect(questions).toHaveLength(10);
    expect(questions.map((q) => q.questionNumber)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('is idempotent: re-running does not create duplicates', async () => {
    await seedQuestions(questionSeedData);
    const firstIds = (await Question.find().sort({ questionNumber: 1 })).map((q) => q.id);

    const second = await seedQuestions(questionSeedData);
    expect(second).toEqual({ inserted: 0, updated: 0, unchanged: 10 });
    expect(await Question.countDocuments()).toBe(10);
    const secondIds = (await Question.find().sort({ questionNumber: 1 })).map((q) => q.id);
    expect(secondIds).toEqual(firstIds);
  });

  it('updates existing question text in place when the seed data changes', async () => {
    await seedQuestions(questionSeedData);
    const original = await Question.findOne({ questionNumber: 4 });

    const revised: QuestionSeed[] = questionSeedData.map((q) =>
      q.questionNumber === 4 ? { ...q, questionText: 'Final customer question 4' } : q,
    );
    const result = await seedQuestions(revised);
    expect(result).toEqual({ inserted: 0, updated: 1, unchanged: 9 });

    const updated = await Question.findOne({ questionNumber: 4 });
    expect(updated?.id).toBe(original?.id); // same record, so existing responses stay linked
    expect(updated?.questionText).toBe('Final customer question 4');
    expect(await Question.countDocuments()).toBe(10);
  });

  it('reactivates inactive questions and never deletes records', async () => {
    await seedQuestions(questionSeedData);
    await Question.updateOne({ questionNumber: 2 }, { isActive: false });

    const result = await seedQuestions(questionSeedData);
    expect(result.updated).toBe(1);
    expect(await Question.countDocuments({ isActive: true })).toBe(10);
    expect(await Question.countDocuments()).toBe(10);
  });
});
