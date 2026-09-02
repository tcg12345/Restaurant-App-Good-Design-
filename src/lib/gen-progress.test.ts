import { beforeEach, describe, expect, it } from 'vitest';
import {
  PROGRESS_CEILING,
  estimateProgress,
  estimateRemainingMs,
  formatRemaining,
  loadExpectation,
  recordGeneration,
} from './gen-progress';

// A throwaway localStorage for the calibration tests.
function installStorage() {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => store.clear(),
  };
}

describe('gen-progress', () => {
  beforeEach(installStorage);

  it('falls back to defaults with nothing recorded', () => {
    expect(loadExpectation('ideas').chars).toBeGreaterThan(0);
    expect(loadExpectation('recipe').ms).toBeGreaterThan(loadExpectation('ideas').ms);
  });

  it('creeps on time while nothing has streamed, capped at a quarter', () => {
    const expected = { chars: 1000, ms: 10000 };
    expect(estimateProgress({ elapsedMs: 0, chars: 0, expected })).toBe(0);
    expect(estimateProgress({ elapsedMs: 2000, chars: 0, expected })).toBeCloseTo(0.12);
    expect(estimateProgress({ elapsedMs: 60000, chars: 0, expected })).toBe(0.25);
  });

  it('follows characters once they arrive and never claims done', () => {
    const expected = { chars: 1000, ms: 10000 };
    expect(estimateProgress({ elapsedMs: 3000, chars: 500, expected })).toBeCloseTo(0.5);
    expect(estimateProgress({ elapsedMs: 3000, chars: 900, expected })).toBeCloseTo(0.9);
    expect(estimateProgress({ elapsedMs: 3000, chars: 5000, expected })).toBe(PROGRESS_CEILING);
  });

  it('lets time carry a slow trickle, but only up to half', () => {
    const expected = { chars: 1000, ms: 10000 };
    expect(estimateProgress({ elapsedMs: 9000, chars: 50, expected })).toBeCloseTo(0.5);
  });

  it('projects remaining time from the observed rate', () => {
    const expected = { chars: 1000, ms: 10000 };
    expect(estimateRemainingMs({ elapsedMs: 1000, chars: 0, expected })).toBeNull();
    expect(estimateRemainingMs({ elapsedMs: 2000, chars: 0, expected })).toBe(8000);
    // 250 chars in 4s → 1000 chars in 16s → 12s to go.
    expect(estimateRemainingMs({ elapsedMs: 4000, chars: 250, expected })).toBe(12000);
    expect(estimateRemainingMs({ elapsedMs: 4000, chars: 990, expected })).toBeLessThan(500);
  });

  it('formats the label', () => {
    expect(formatRemaining(null)).toBe('');
    expect(formatRemaining(900)).toBe('Almost there');
    expect(formatRemaining(12000)).toBe('About 12s left');
    expect(formatRemaining(130000)).toBe('About 3 min left');
  });

  it('learns from finished generations with a half-weight average', () => {
    expect(recordGeneration('ideas', { chars: 2000, ms: 8000 })).toEqual({ chars: 2000, ms: 8000 });
    expect(recordGeneration('ideas', { chars: 3000, ms: 12000 })).toEqual({ chars: 2500, ms: 10000 });
    expect(loadExpectation('ideas')).toEqual({ chars: 2500, ms: 10000 });
    // Garbage is ignored, not learned.
    expect(recordGeneration('ideas', { chars: 5, ms: 0 })).toEqual({ chars: 2500, ms: 10000 });
  });
});
