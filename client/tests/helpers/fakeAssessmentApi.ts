import { vi } from 'vitest';

export const TOKEN = 'T'.repeat(43);

export interface FakeQuestion {
  id: string;
  questionNumber: number;
  questionText: string;
}

export const QUESTIONS: FakeQuestion[] = Array.from({ length: 10 }, (_, i) => ({
  id: `${String(i + 1).padStart(2, '0')}`.padEnd(24, 'a'),
  questionNumber: i + 1,
  questionText: `Question text number ${i + 1}?`,
}));

type Status = 'Invited' | 'In Progress' | 'Completed';

interface Options {
  status?: Status;
  answers?: Record<number, string>;
  /** Question numbers that already have an uploaded video. */
  videos?: number[];
  /** HTTP status to return for GET /assessment instead of the data. */
  loadError?: { status: number; code: string };
}

/** Answers + videos for questions 1..n (i.e. the first n questions complete). */
export function completeUpTo(n: number): Required<Pick<Options, 'answers' | 'videos'>> {
  const answers: Record<number, string> = {};
  const videos: number[] = [];
  for (let i = 1; i <= n; i++) {
    answers[i] = `Answer ${i}`;
    videos.push(i);
  }
  return { answers, videos };
}

/**
 * In-memory stand-in for the candidate assessment API and the S3 bucket. Records every request
 * and lets tests make saves/uploads fail or hang to exercise error handling and retries.
 */
export function installFakeAssessmentApi(options: Options = {}) {
  const state = {
    status: (options.status ?? 'Invited') as Status,
    answers: new Map<string, string>(
      Object.entries(options.answers ?? {}).map(([n, text]) => [QUESTIONS[Number(n) - 1]!.id, text]),
    ),
    videoKeys: new Map<string, string>(
      (options.videos ?? []).map((n) => [QUESTIONS[n - 1]!.id, `videos/existing/${n}.webm`]),
    ),
    failSaves: false,
    saveDelayMs: 0,
    inFlight: 0,
    maxInFlight: 0,
    /** Number of upcoming S3 PUTs that fail with a network error. */
    failNextPuts: 0,
    /** When set, PUTs wait for this promise before completing (to observe progress). */
    holdPuts: null as Promise<void> | null,
    s3Objects: new Set<string>(),
    deletedKeys: [] as string[],
    keyCounter: 0,
  };
  const saves: Array<{ questionId: string; writtenAnswer: string; token: string | undefined }> = [];
  const starts: number[] = [];
  const uploadUrlRequests: Array<{ questionId: string; mimeType: string; sizeBytes: number }> = [];
  const puts: Array<{ url: string; headers: Record<string, string>; size: number }> = [];
  const confirms: Array<{ questionId: string; objectKey: string }> = [];

  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  function responseFor(questionId: string) {
    const answer = state.answers.get(questionId);
    const hasVideo = state.videoKeys.has(questionId);
    if (answer === undefined && !hasVideo) return null;
    return {
      questionId,
      writtenAnswer: answer ?? '',
      videoStatus: hasVideo ? 'Uploaded' : 'Missing',
      updatedAt: `2026-01-01T00:00:0${state.keyCounter % 10}.000Z`,
    };
  }

  function assessmentBody() {
    const questions = QUESTIONS.map((q) => {
      const response = responseFor(q.id);
      return { ...q, status: response ? 'In Progress' : 'Not Started', response };
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
      progress: { writtenAnswered: state.answers.size, videosUploaded: state.videoKeys.size, questionsComplete: 0, total: 10 },
    };
  }

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const path = url.pathname.replace(/^\/api/, '');
    const method = init?.method ?? 'GET';
    const token = (init?.headers as Record<string, string> | undefined)?.['X-Assessment-Token'];
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};

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
    const match = /^\/assessment\/questions\/([^/]+)\/(response|video-upload-url|video-confirm|video-url)$/.exec(path);
    const questionId = match ? decodeURIComponent(match[1]!) : '';

    if (method === 'PUT' && match?.[2] === 'response') {
      const { writtenAnswer } = body as { writtenAnswer: string };
      state.inFlight += 1;
      state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
      try {
        if (state.saveDelayMs) await new Promise((r) => setTimeout(r, state.saveDelayMs));
        saves.push({ questionId, writtenAnswer, token });
        if (state.failSaves) return json(500, { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
        state.answers.set(questionId, writtenAnswer);
        return json(200, { response: responseFor(questionId) });
      } finally {
        state.inFlight -= 1;
      }
    }
    if (method === 'POST' && match?.[2] === 'video-upload-url') {
      uploadUrlRequests.push({ questionId, ...(body as { mimeType: string; sizeBytes: number }) });
      state.keyCounter += 1;
      const objectKey = `videos/cand/${questionId}/${state.keyCounter}.webm`;
      return json(200, {
        uploadUrl: `https://s3.test/${objectKey}?sig=1`,
        objectKey,
        method: 'PUT',
        headers: { 'Content-Type': 'video/webm' },
        expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
      });
    }
    if (method === 'POST' && match?.[2] === 'video-confirm') {
      const { objectKey } = body as { objectKey: string };
      confirms.push({ questionId, objectKey });
      if (!state.s3Objects.has(objectKey)) {
        return json(409, { error: { code: 'VIDEO_NOT_UPLOADED', message: 'The video upload was not found.' } });
      }
      const previous = state.videoKeys.get(questionId);
      state.videoKeys.set(questionId, objectKey);
      if (previous && previous !== objectKey) state.deletedKeys.push(previous);
      return json(200, { response: responseFor(questionId) });
    }
    if (method === 'GET' && match?.[2] === 'video-url') {
      const key = state.videoKeys.get(questionId);
      if (!key) return json(404, { error: { code: 'VIDEO_NOT_FOUND', message: 'No video has been uploaded.' } });
      return json(200, { url: `https://s3.test/${key}?download=1`, mimeType: 'video/webm', expiresAt: '2030-01-01T00:00:00Z' });
    }
    throw new Error(`Unexpected request: ${method} ${path}`);
  });

  /** Fake XMLHttpRequest that "uploads" to the in-memory bucket with progress events. */
  class FakeXHR {
    upload: { onprogress: ((e: ProgressEvent) => void) | null } = { onprogress: null };
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onabort: (() => void) | null = null;
    status = 0;
    private url = '';
    private headers: Record<string, string> = {};
    open(_method: string, url: string) {
      this.url = url;
    }
    setRequestHeader(name: string, value: string) {
      this.headers[name] = value;
    }
    abort() {
      this.onabort?.();
    }
    send(blob: Blob) {
      puts.push({ url: this.url, headers: { ...this.headers }, size: blob.size });
      void (async () => {
        await Promise.resolve();
        const total = blob.size;
        this.upload.onprogress?.({ lengthComputable: true, loaded: Math.floor(total / 2), total } as ProgressEvent);
        if (state.holdPuts) await state.holdPuts;
        if (state.failNextPuts > 0) {
          state.failNextPuts -= 1;
          this.onerror?.();
          return;
        }
        this.upload.onprogress?.({ lengthComputable: true, loaded: total, total } as ProgressEvent);
        state.s3Objects.add(new URL(this.url).pathname.slice(1));
        this.status = 200;
        this.onload?.();
      })();
    }
  }

  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('XMLHttpRequest', FakeXHR);
  return { state, saves, starts, uploadUrlRequests, puts, confirms, fetchMock };
}
