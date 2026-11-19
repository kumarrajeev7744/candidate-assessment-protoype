import { Schema, model, type HydratedDocument } from 'mongoose';
import { TOTAL_QUESTIONS } from './constants.js';

export interface IQuestion {
  /** 1-based position in the assessment; defines question order. */
  questionNumber: number;
  questionText: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const questionSchema = new Schema<IQuestion>(
  {
    questionNumber: {
      type: Number,
      required: [true, 'Question number is required'],
      unique: true,
      min: [1, 'Question number must be between 1 and 10'],
      max: [TOTAL_QUESTIONS, 'Question number must be between 1 and 10'],
      validate: { validator: Number.isInteger, message: 'Question number must be an integer' },
    },
    questionText: {
      type: String,
      required: [true, 'Question text is required'],
      trim: true,
      minlength: 1,
      maxlength: 2000,
    },
    isActive: { type: Boolean, default: true, required: true },
  },
  { timestamps: true },
);

export const Question = model<IQuestion>('Question', questionSchema);
export type QuestionDocument = HydratedDocument<IQuestion>;
