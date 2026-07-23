/* ── Score unlock (Beli-style) ──────────────────────────────────────────
   Numeric scores are hidden until the user has rated enough restaurants
   for the head-to-head rankings to mean something — with only a handful
   of ratings each comparison has little to anchor against, so the
   interpolated numbers swing wildly. Below the threshold the app shows
   rank + sentiment instead of numbers, and holds off publishing to the
   community entirely (an inaccurate early score should never reach
   friends' feeds or a restaurant's average). Ten matches Beli, and a
   list import counts, so anyone bringing their Beli history unlocks
   instantly. */

export const SCORE_UNLOCK_THRESHOLD = 10;

/** True once numeric scores (and community publishing) are unlocked. */
export const scoresUnlocked = (ratedCount: number): boolean =>
  ratedCount >= SCORE_UNLOCK_THRESHOLD;

/** How many more ratings until scores unlock (0 when already unlocked). */
export const ratingsToUnlock = (ratedCount: number): number =>
  Math.max(0, SCORE_UNLOCK_THRESHOLD - ratedCount);
