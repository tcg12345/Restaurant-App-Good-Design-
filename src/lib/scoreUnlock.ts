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

/**
 * Where a score lands in the user's own ladder: 1-based rank and total,
 * with the rated row itself counted once.
 *
 * Ties resolve UPWARD (`>=`) to match the settle pass, so the number shown
 * is the one that persists. Lives here rather than in a component so
 * ListsContext can use it — a context importing from a component file is
 * an import cycle waiting to happen.
 */
export function rankAmong(
  ratings: Array<{ restaurantId: string; score: number }>,
  score: number,
  excludeId?: string,
): { rank: number; total: number } {
  const others = ratings.filter((r) => r.restaurantId !== excludeId);
  const rank = 1 + others.filter((r) => r.score >= score).length;
  return { rank, total: others.length + 1 };
}
