import { describe, it, expect } from 'vitest';
import { DURATION_STEPS, minutesForStep, stepForMinutes, formatDuration } from './duration-scale';

describe('minutesForStep', () => {
  it('starts at zero and ends at 24 hours', () => {
    expect(minutesForStep(0)).toBe(0);
    expect(minutesForStep(DURATION_STEPS)).toBe(24 * 60);
  });

  it('is per-minute where recipes actually live', () => {
    expect(minutesForStep(1)).toBe(1);
    expect(minutesForStep(25)).toBe(25);
    expect(minutesForStep(29)).toBe(29);
  });

  it('opens up to 5-minute strides after half an hour', () => {
    expect(minutesForStep(30)).toBe(30);
    expect(minutesForStep(31)).toBe(35);
    expect(minutesForStep(47)).toBe(115);
  });

  it('coarsens again past two hours and past six', () => {
    expect(minutesForStep(48)).toBe(120);
    expect(minutesForStep(49)).toBe(135);
    expect(minutesForStep(64)).toBe(360);
    expect(minutesForStep(65)).toBe(390);
  });

  it('never goes backwards', () => {
    for (let i = 1; i <= DURATION_STEPS; i++) {
      expect(minutesForStep(i)).toBeGreaterThan(minutesForStep(i - 1));
    }
  });

  it('clamps out-of-range positions rather than returning nonsense', () => {
    expect(minutesForStep(-5)).toBe(0);
    expect(minutesForStep(9999)).toBe(24 * 60);
  });
});

describe('stepForMinutes', () => {
  it('round-trips every detent exactly', () => {
    for (let i = 0; i <= DURATION_STEPS; i++) {
      expect(stepForMinutes(minutesForStep(i))).toBe(i);
    }
  });

  it('snaps an off-detent value to its nearest detent', () => {
    expect(minutesForStep(stepForMinutes(33))).toBe(35);  // 33 → 35, not 30
    expect(minutesForStep(stepForMinutes(63))).toBe(65);
    expect(minutesForStep(stepForMinutes(1000))).toBe(990);
  });

  it('keeps the lower detent on an exact tie, so values do not drift up', () => {
    // 32.5 is midway between 30 and 35; 32 must not become 35.
    expect(minutesForStep(stepForMinutes(32))).toBe(30);
  });

  it('clamps rather than throwing on junk', () => {
    expect(stepForMinutes(-40)).toBe(0);
    expect(stepForMinutes(99999)).toBe(DURATION_STEPS);
    expect(stepForMinutes(NaN)).toBe(0);
  });
});

describe('formatDuration', () => {
  it('reads the way a cook would say it', () => {
    expect(formatDuration(0)).toBe('—');
    expect(formatDuration(1)).toBe('1 min');
    expect(formatDuration(45)).toBe('45 min');
    expect(formatDuration(60)).toBe('1h');
    expect(formatDuration(95)).toBe('1h 35m');
    expect(formatDuration(1440)).toBe('24h');
  });
});
