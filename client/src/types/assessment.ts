import type { InvitationStatus } from './invitation';

export type VideoStatus = 'Missing' | 'Pending' | 'Uploaded' | 'Failed';
export type QuestionProgressStatus = 'Not Started' | 'In Progress' | 'Complete';

export interface SavedResponse {
  questionId: string;
  writtenAnswer: string;
  videoStatus: VideoStatus;
  updatedAt: string;
}

export interface AssessmentQuestion {
  id: string;
  questionNumber: number;
  questionText: string;
  status: QuestionProgressStatus;
  response: SavedResponse | null;
}

export interface AssessmentInfo {
  status: InvitationStatus;
  expiresAt: string;
  totalQuestions: number;
  writtenAnswerMaxLength: number;
  videoMaxSeconds: number;
}

export interface CandidateInfo {
  name: string;
  email: string;
}

export interface AssessmentData {
  candidate: CandidateInfo;
  assessment: AssessmentInfo;
  questions: AssessmentQuestion[];
  progress: { writtenAnswered: number; videosUploaded: number; questionsComplete: number; total: number };
}

export interface StartAssessmentResult {
  candidate: CandidateInfo;
  assessment: AssessmentInfo;
}

export interface SubmitAssessmentResult {
  assessment: { status: 'Completed'; completedAt: string };
  message: string;
  confirmationEmail: { sent: boolean };
}

export interface MissingResponse {
  questionNumber: number;
  writtenMissing: boolean;
  videoMissing: boolean;
}
