import type { CandidateReport, ReportQuestion, VideoPlayback } from '../../src/types/report';

export const CANDIDATE_ID = 'c'.repeat(24);

export function video(n: number, overrides: Partial<VideoPlayback> = {}): VideoPlayback {
  return {
    status: 'Uploaded',
    available: true,
    url: `https://s3.test/v/${n}.webm?sig=1`,
    mimeType: 'video/webm',
    urlExpiresAt: '2030-01-01T00:00:00Z',
    ...overrides,
  };
}

export function question(n: number, overrides: Partial<ReportQuestion> = {}): ReportQuestion {
  return {
    questionId: `q${n}`.padEnd(24, '0'),
    questionNumber: n,
    questionText: `Report question ${n}?`,
    status: 'Complete',
    response: {
      id: `r${n}`.padEnd(24, '0'),
      writtenAnswer: `Written answer ${n}`,
      hasWrittenAnswer: true,
      video: video(n),
      updatedAt: '2026-11-20T10:00:00Z',
    },
    canShare: true,
    ...overrides,
  };
}

export function makeReport(overrides: Partial<CandidateReport> = {}): CandidateReport {
  return {
    candidate: { id: CANDIDATE_ID, name: 'Priya Sharma', email: 'priya@example.com', rejection: null },
    assessment: {
      status: 'Completed',
      invitedAt: '2026-11-15T10:00:00Z',
      expiresAt: '2026-11-22T10:00:00Z',
      completedAt: '2026-11-20T09:30:00Z',
      isExpired: false,
    },
    questions: Array.from({ length: 10 }, (_, i) => question(i + 1)),
    summary: { completedQuestions: 10, totalQuestions: 10 },
    ...overrides,
  };
}
