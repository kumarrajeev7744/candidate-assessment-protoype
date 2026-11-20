import type { InvitationStatus } from './invitation';

export interface VideoPlayback {
  status: 'Missing' | 'Pending' | 'Uploaded' | 'Failed';
  available: boolean;
  url: string | null;
  mimeType: string | null;
  urlExpiresAt: string | null;
}

export interface ReportQuestion {
  questionId: string;
  questionNumber: number;
  questionText: string;
  status: 'Complete' | 'Incomplete' | 'Not Started';
  response: {
    id: string;
    writtenAnswer: string;
    hasWrittenAnswer: boolean;
    video: VideoPlayback;
    updatedAt: string;
  } | null;
  canShare: boolean;
}

export interface CandidateReport {
  candidate: { id: string; name: string; email: string };
  assessment: {
    status: InvitationStatus;
    invitedAt: string;
    expiresAt: string;
    completedAt: string | null;
    isExpired: boolean;
  };
  questions: ReportQuestion[];
  summary: { completedQuestions: number; totalQuestions: number };
}

export interface ShareResult {
  shareLink: { id: string; recipientEmail: string; createdAt: string; expiresAt: string; emailStatus: string; emailSentAt: string | null };
  reused: boolean;
  email: { sent: boolean };
}

export interface SharedResponse {
  type: 'response';
  candidateName: string;
  question: { number: number; text: string };
  response: { writtenAnswer: string; video: VideoPlayback };
  expiresAt: string;
}

export interface SharedReport {
  type: 'report';
  candidateName: string;
  questions: Array<{ number: number; text: string; writtenAnswer: string; video: VideoPlayback }>;
  expiresAt: string;
}

export type SharedContent = SharedResponse | SharedReport;
