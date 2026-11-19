import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { ApiError } from '../services/apiClient';
import * as assessmentApi from '../services/assessmentService';
import type { AssessmentData, AssessmentQuestion, SavedResponse } from '../types/assessment';

/** Tunable for tests. */
export const assessmentSettings = { autosaveDelayMs: 1000 };

export type SaveStatus = 'idle' | 'unsaved' | 'saving' | 'saved' | 'error';

export type FatalKind = 'invalid' | 'expired' | 'completed' | 'unavailable';

export type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready' }
  | { kind: 'fatal'; reason: FatalKind; message: string }
  | { kind: 'error'; message: string };

export interface AssessmentContextValue {
  token: string;
  load: LoadState;
  data: AssessmentData | null;
  drafts: Record<string, string>;
  saveStatus: Record<string, SaveStatus>;
  saveError: string | null;
  writtenAnsweredCount: number;
  /** Questions with a written answer and a confirmed video upload. */
  completedCount: number;
  /** 1-based number of the first incomplete question, or null when all are complete. */
  firstIncompleteNumber: number | null;
  isQuestionComplete: (question: AssessmentQuestion) => boolean;
  /** Merges a response returned by the API (e.g. after a video upload) into the loaded data. */
  applySavedResponse: (response: SavedResponse) => void;
  /** Switches to the invalid/expired/submitted screen for such errors. Returns true if handled. */
  handleFatalError: (err: unknown) => boolean;
  reload: () => void;
  start: () => Promise<void>;
  updateDraft: (questionId: string, text: string) => void;
  /** Saves immediately (waiting for any in-flight save of the same question). Resolves false on failure. */
  saveNow: (questionId: string) => Promise<boolean>;
  hasUnsavedChanges: boolean;
}

const AssessmentContext = createContext<AssessmentContextValue | null>(null);

/** Errors that end the session (link invalid/expired/submitted) rather than a retryable failure. */
function fatalFromError(err: unknown): LoadState | null {
  if (!(err instanceof ApiError)) return null;
  if (err.status === 401) return { kind: 'fatal', reason: 'invalid', message: err.message };
  if (err.status === 410) return { kind: 'fatal', reason: 'expired', message: err.message };
  if (err.status === 409 && err.code === 'ASSESSMENT_COMPLETED') {
    return { kind: 'fatal', reason: 'completed', message: err.message };
  }
  if (err.status === 503) return { kind: 'fatal', reason: 'unavailable', message: err.message };
  return null;
}

function retryableMessage(err: unknown): string {
  if (err instanceof ApiError && err.status === 0) return err.message;
  if (err instanceof ApiError && err.status < 500) return err.message;
  return 'Something went wrong on our side. Please try again.';
}

export function AssessmentProvider({ token, children }: { token: string; children: ReactNode }) {
  const [load, setLoad] = useState<LoadState>({ kind: 'loading' });
  const [data, setData] = useState<AssessmentData | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saveStatus, setSaveStatus] = useState<Record<string, SaveStatus>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const draftsRef = useRef<Record<string, string>>({});
  const savedRef = useRef<Record<string, string>>({});
  const chainsRef = useRef(new Map<string, Promise<boolean>>());
  const timersRef = useRef(new Map<string, number>());
  const scheduleRef = useRef<(questionId: string) => void>(() => undefined);

  const setStatus = useCallback((questionId: string, status: SaveStatus) => {
    setSaveStatus((prev) => (prev[questionId] === status ? prev : { ...prev, [questionId]: status }));
  }, []);

  // Load (or reload) the assessment for this invitation token.
  useEffect(() => {
    let cancelled = false;
    assessmentApi
      .fetchAssessment(token)
      .then((result) => {
        if (cancelled) return;
        const initial: Record<string, string> = {};
        for (const q of result.questions) initial[q.id] = q.response?.writtenAnswer ?? '';
        draftsRef.current = { ...initial };
        savedRef.current = { ...initial };
        setDrafts(initial);
        setSaveStatus({});
        setData(result);
        setLoad({ kind: 'ready' });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoad(fatalFromError(err) ?? { kind: 'error', message: retryableMessage(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [token, attempt]);

  // Clear pending autosave timers on unmount.
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const t of timers.values()) window.clearTimeout(t);
      timers.clear();
    };
  }, []);

  const reload = useCallback(() => {
    setLoad({ kind: 'loading' });
    setAttempt((n) => n + 1);
  }, []);

  const performSave = useCallback(
    async (questionId: string): Promise<boolean> => {
      const text = draftsRef.current[questionId] ?? '';
      if (text === (savedRef.current[questionId] ?? '')) {
        setSaveStatus((prev) =>
          prev[questionId] && prev[questionId] !== 'idle' ? { ...prev, [questionId]: 'saved' } : prev,
        );
        return true;
      }
      setStatus(questionId, 'saving');
      try {
        const saved = await assessmentApi.saveWrittenAnswer(token, questionId, text);
        savedRef.current[questionId] = saved.writtenAnswer;
        setData((prev) =>
          prev && {
            ...prev,
            questions: prev.questions.map((q): AssessmentQuestion => (q.id === questionId ? { ...q, response: saved } : q)),
          },
        );
        setSaveError(null);
        if (draftsRef.current[questionId] === text) {
          setStatus(questionId, 'saved');
        } else {
          setStatus(questionId, 'unsaved'); // typed more while saving
          scheduleRef.current(questionId);
        }
        return true;
      } catch (err) {
        const fatal = fatalFromError(err);
        if (fatal) setLoad(fatal);
        setStatus(questionId, 'error');
        setSaveError(
          err instanceof ApiError && err.status === 0
            ? 'Save failed: you appear to be offline. Your text is kept on this page.'
            : `Save failed. ${retryableMessage(err)} Your text is kept on this page.`,
        );
        return false;
      }
    },
    [token, setStatus],
  );

  const saveNow = useCallback(
    (questionId: string): Promise<boolean> => {
      const timer = timersRef.current.get(questionId);
      if (timer !== undefined) {
        window.clearTimeout(timer);
        timersRef.current.delete(questionId);
      }
      // Chain saves per question so requests for the same response never overlap.
      const previous = chainsRef.current.get(questionId) ?? Promise.resolve(true);
      const next = previous.then(() => performSave(questionId));
      chainsRef.current.set(questionId, next);
      return next;
    },
    [performSave],
  );

  const schedule = useCallback(
    (questionId: string) => {
      const existing = timersRef.current.get(questionId);
      if (existing !== undefined) window.clearTimeout(existing);
      const timer = window.setTimeout(() => {
        timersRef.current.delete(questionId);
        void saveNow(questionId);
      }, assessmentSettings.autosaveDelayMs);
      timersRef.current.set(questionId, timer);
    },
    [saveNow],
  );

  useEffect(() => {
    scheduleRef.current = schedule;
  }, [schedule]);

  const updateDraft = useCallback(
    (questionId: string, text: string) => {
      const max = data?.assessment.writtenAnswerMaxLength ?? 1000;
      const value = text.slice(0, max);
      draftsRef.current[questionId] = value;
      setDrafts((prev) => ({ ...prev, [questionId]: value }));
      setStatus(questionId, value === (savedRef.current[questionId] ?? '') ? 'saved' : 'unsaved');
      schedule(questionId);
    },
    [data, schedule, setStatus],
  );

  const start = useCallback(async () => {
    const result = await assessmentApi.startAssessment(token);
    setData((prev) => prev && { ...prev, candidate: result.candidate, assessment: result.assessment });
  }, [token]);

  // Flush pending autosaves when the tab is hidden or closed (keepalive requests survive unload).
  const saveStatusRef = useRef(saveStatus);
  useEffect(() => {
    saveStatusRef.current = saveStatus;
  }, [saveStatus]);
  useEffect(() => {
    const flush = () => {
      for (const [questionId, status] of Object.entries(saveStatusRef.current)) {
        if (status === 'unsaved' || timersRef.current.has(questionId)) void saveNow(questionId);
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', flush);
    };
  }, [saveNow]);

  const hasUnsavedChanges = Object.values(saveStatus).some((s) => s === 'unsaved' || s === 'saving' || s === 'error');

  // Warn before leaving the page with unsaved text.
  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [hasUnsavedChanges]);

  const writtenAnsweredCount = Object.values(drafts).filter((text) => text.trim().length > 0).length;

  const isQuestionComplete = useCallback(
    (q: AssessmentQuestion) => (drafts[q.id] ?? '').trim().length > 0 && q.response?.videoStatus === 'Uploaded',
    [drafts],
  );
  const questions = data?.questions;
  const completedCount = questions?.filter(isQuestionComplete).length ?? 0;
  const firstIncompleteIndex = questions?.findIndex((q) => !isQuestionComplete(q)) ?? -1;
  const firstIncompleteNumber = firstIncompleteIndex === -1 ? null : firstIncompleteIndex + 1;

  const applySavedResponse = useCallback((response: SavedResponse) => {
    setData(
      (prev) =>
        prev && {
          ...prev,
          questions: prev.questions.map((q) => (q.id === response.questionId ? { ...q, response } : q)),
        },
    );
  }, []);

  const handleFatalError = useCallback((err: unknown) => {
    const fatal = fatalFromError(err);
    if (fatal) setLoad(fatal);
    return Boolean(fatal);
  }, []);

  const value = useMemo<AssessmentContextValue>(
    () => ({
      token,
      load,
      data,
      drafts,
      saveStatus,
      saveError,
      writtenAnsweredCount,
      completedCount,
      firstIncompleteNumber,
      isQuestionComplete,
      applySavedResponse,
      handleFatalError,
      reload,
      start,
      updateDraft,
      saveNow,
      hasUnsavedChanges,
    }),
    [
      token,
      load,
      data,
      drafts,
      saveStatus,
      saveError,
      writtenAnsweredCount,
      completedCount,
      firstIncompleteNumber,
      isQuestionComplete,
      applySavedResponse,
      handleFatalError,
      reload,
      start,
      updateDraft,
      saveNow,
      hasUnsavedChanges,
    ],
  );

  return <AssessmentContext.Provider value={value}>{children}</AssessmentContext.Provider>;
}

export function useAssessment(): AssessmentContextValue {
  const ctx = useContext(AssessmentContext);
  if (!ctx) throw new Error('useAssessment must be used within an AssessmentProvider');
  return ctx;
}
