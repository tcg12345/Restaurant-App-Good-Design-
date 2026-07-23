import { describe, it, expect } from 'vitest';
import { SCORE_UNLOCK_THRESHOLD, scoresUnlocked, ratingsToUnlock } from './scoreUnlock';

describe('scoreUnlock', () => {
  it('locks below the threshold and unlocks at it', () => {
    expect(scoresUnlocked(0)).toBe(false);
    expect(scoresUnlocked(SCORE_UNLOCK_THRESHOLD - 1)).toBe(false);
    expect(scoresUnlocked(SCORE_UNLOCK_THRESHOLD)).toBe(true);
    expect(scoresUnlocked(SCORE_UNLOCK_THRESHOLD + 25)).toBe(true);
  });

  it('counts down remaining ratings and floors at zero', () => {
    expect(ratingsToUnlock(0)).toBe(SCORE_UNLOCK_THRESHOLD);
    expect(ratingsToUnlock(SCORE_UNLOCK_THRESHOLD - 3)).toBe(3);
    expect(ratingsToUnlock(SCORE_UNLOCK_THRESHOLD)).toBe(0);
    expect(ratingsToUnlock(SCORE_UNLOCK_THRESHOLD + 5)).toBe(0);
  });
});
