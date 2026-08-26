import { describe, it, expect } from 'vitest';
import { SCORE_UNLOCK_THRESHOLD, scoresUnlocked, ratingsToUnlock, rankAmong } from './scoreUnlock';

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

describe('rankAmong', () => {
  const r = (restaurantId: string, score: number) => ({ restaurantId, score });

  it('is 1-based and counts the rated row itself', () => {
    expect(rankAmong([r('a', 9)], 9, 'a')).toEqual({ rank: 1, total: 1 });
  });

  it('places a score against its neighbours', () => {
    const ladder = [r('a', 9.5), r('b', 8.0), r('c', 6.0)];
    expect(rankAmong(ladder, 8.5, 'x')).toEqual({ rank: 2, total: 4 });
    expect(rankAmong(ladder, 10, 'x')).toEqual({ rank: 1, total: 4 });
    expect(rankAmong(ladder, 1, 'x')).toEqual({ rank: 4, total: 4 });
  });

  it('resolves ties upward, matching what the settle pass persists', () => {
    // A tie must not claim the higher slot — the displayed rank has to be
    // the one the user will still see after the ladder settles.
    expect(rankAmong([r('a', 8), r('b', 8)], 8, 'x')).toEqual({ rank: 3, total: 3 });
  });

  it('excludes the row being re-rated so it never ranks against itself', () => {
    const ladder = [r('a', 9), r('me', 5)];
    expect(rankAmong(ladder, 9.5, 'me')).toEqual({ rank: 1, total: 2 });
  });
});
