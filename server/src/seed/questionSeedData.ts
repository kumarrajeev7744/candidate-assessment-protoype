/**
 * The 10 fixed assessment questions, in order.
 *
 * PLACEHOLDER CONTENT: the customer has not yet supplied the final question text.
 * Replace each `questionText` below with the real question, then re-run
 * `npm run seed:questions --workspace server`. Existing records are updated in place.
 */
export interface QuestionSeed {
  questionNumber: number;
  questionText: string;
}

export const questionSeedData: QuestionSeed[] = [
  { questionNumber: 1, questionText: '[PLACEHOLDER] Question 1 – replace with customer-provided text.' },
  { questionNumber: 2, questionText: '[PLACEHOLDER] Question 2 – replace with customer-provided text.' },
  { questionNumber: 3, questionText: '[PLACEHOLDER] Question 3 – replace with customer-provided text.' },
  { questionNumber: 4, questionText: '[PLACEHOLDER] Question 4 – replace with customer-provided text.' },
  { questionNumber: 5, questionText: '[PLACEHOLDER] Question 5 – replace with customer-provided text.' },
  { questionNumber: 6, questionText: '[PLACEHOLDER] Question 6 – replace with customer-provided text.' },
  { questionNumber: 7, questionText: '[PLACEHOLDER] Question 7 – replace with customer-provided text.' },
  { questionNumber: 8, questionText: '[PLACEHOLDER] Question 8 – replace with customer-provided text.' },
  { questionNumber: 9, questionText: '[PLACEHOLDER] Question 9 – replace with customer-provided text.' },
  { questionNumber: 10, questionText: '[PLACEHOLDER] Question 10 – replace with customer-provided text.' },
];
