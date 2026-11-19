import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// jsdom has no object URLs or media playback.
let objectUrlCounter = 0;
URL.createObjectURL = vi.fn(() => `blob:fake/${++objectUrlCounter}`);
URL.revokeObjectURL = vi.fn();

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  localStorage.clear();
});
