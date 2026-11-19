import { vi } from 'vitest';

export const TOKEN = 'T'.repeat(43);

export interface FakeQuestion {
  id: string;
  questionNumber: number;
  questionText: string;
}

export const QUESTIONS: FakeQuestion[] = Array.from({ length: 10 }, (_, i) => ({
  id: `q${String(i + 1).padStart(2, '0')}`.padEnd(24, '0'),
  questionNumber: i + 1,
  questionText: `Question text number ${i + 1}?`,
}));

type Status = 'Invited' | 'In Progress' | 'Completed';

interface Options {
  status?: Status;
  answers?: Record<number, string>;
  /** HTTP status to return for GET /assessment instead of the data. */
  loadError?: { status: number; code: string };
}

/**
 * In-memory stand-in for the candidate assessment API. Records every request and lets
 * tests make saves fail or hang to exercise error handling and request ordering.
 */
export function installFakeAssessmentApi(options: Options = {}) {
  const state = {
    status: (options.status ?? 'Invited') as Status,
    answers: new Map<string, string>(
      Object.entries(options.answers ?? {}).map(([n, text]) => [QUESTIONS[Number(n) - 1]!.id, text]),
    ),
    failSaves: false,
    saveDelayMs: 0,
    inFlight: 0,
    maxInFlight: 0,
  };
  const saves: Array<{ questionId: string; writtenAnswer: string; token: string | undefined }> = [];
  const starts: number[] = [];

  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  function assessmentBody() {
    const questions = QUESTIONS.map((q) => {
      const answer = state.answers.get(q.id);
      return {
        ...q,
        status: answer ? 'In Progress' : 'Not Started',
        response:
          answer === undefined
            ? null
            : { questionId: q.id, writtenAnswer: answer, videoStatus: 'Missing', updatedAt: '2026-01-01T00:00:00.000Z' },
      };
    });
    const info = {
      status: state.status,
      expiresAt: '2030-01-01T00:00:00.000Z',
      totalQuestions: 10,
      writtenAnswerMaxLength: 1000,
      videoMaxSeconds: 120,
    };
    return {
      candidate: { name: 'Priya Sharma', email: 'priya@example.com' },
      assessment: info,
      questions,
      progress: {
        writtenAnswered: [...state.answers.values()].filter((a) => a.trim()).length,
        videosUploaded: 0,
        questionsComplete: 0,
        total: 10,
      },
    };
  }

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const path = url.pathname.replace(/^\/api/, '');
    const method = init?.method ?? 'GET';
    const token = (init?.headers as Record<string, string> | undefined)?.['X-Assessment-Token'];

    if (method === 'GET' && path === '/assessment') {
      if (options.loadError) {
        return json(options.loadError.status, { error: { code: options.loadError.code, message: 'Error' } });
      }
      return json(200, assessmentBody());
    }
    if (method === 'POST' && path === '/assessment/start') {
      starts.push(Date.now());
      if (state.status === 'Invited') state.status = 'In Progress';
      const { candidate, assessment } = assessmentBody();
      return json(200, { candidate, assessment });
    }
    const saveMatch = /^\/assessment\/questions\/([^/]+)\/response$/.exec(path);
    if (method === 'PUT' && saveMatch) {
      const questionId = decodeURIComponent(saveMatch[1]!);
      const { writtenAnswer } = JSON.parse(String(init?.body)) as { writtenAnswer: string };
      state.inFlight += 1;
      state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
      try {
        if (state.saveDelayMs) await new Promise((r) => setTimeout(r, state.saveDelayMs));
        saves.push({ questionId, writtenAnswer, token });
        if (state.failSaves) return json(500, { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
        state.answers.set(questionId, writtenAnswer);
        return json(200, {
          response: { questionId, writtenAnswer, videoStatus: 'Missing', updatedAt: new Date().toISOString() },
        });
      } finally {
        state.inFlight -= 1;
      }
    }
    throw new Error(`Unexpected request: ${method} ${path}`);
  });

  vi.stubGlobal('fetch', fetchMock);
  return { state, saves, starts, fetchMock };
}
