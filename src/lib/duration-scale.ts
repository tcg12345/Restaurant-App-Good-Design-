/**
 * The scale behind the recipe builder's Prep / Cook sliders.
 *
 * A linear 0–24h slider is unusable for this: 1440 one-minute steps across
 * a phone-width track is ~5 minutes per pixel, so the values recipes
 * actually use (5, 10, 25, 40 minutes) are unhittable, while three quarters
 * of the travel is spent on overnight ferments nobody is dialling in by
 * hand.
 *
 * So the track is non-linear — fine where cooking happens, coarse in the
 * tail:
 *
 *   0–30 min      every minute      (30 steps)
 *   30 min–2 h    every 5 minutes   (18 steps)
 *   2–6 h         every 15 minutes  (16 steps)
 *   6–24 h        every 30 minutes  (36 steps)
 *
 * 101 detents total, which at ~320px of track is ~3px each — a drag that
 * lands where you meant it to, with every ordinary value reachable.
 *
 * Values that don't sit on a detent (an imported "1h 3m", an AI draft) are
 * never rewritten: they only matter for where the thumb sits, and
 * `stepForMinutes` picks the nearest detent for that.
 */

interface Band {
  /** Minutes at the start of the band. */
  from: number;
  /** Minutes between detents inside it. */
  stride: number;
  /** How many detents the band contributes. */
  steps: number;
}

const BANDS: Band[] = [
  { from: 0, stride: 1, steps: 30 },      // 0 … 29
  { from: 30, stride: 5, steps: 18 },     // 30 … 115
  { from: 120, stride: 15, steps: 16 },   // 120 … 345
  { from: 360, stride: 30, steps: 36 },   // 360 … 1410
];

/** Total detents on the track, inclusive of the 24h end stop. */
export const DURATION_STEPS = BANDS.reduce((n, b) => n + b.steps, 0); // 100 → 0..100

/** Minutes at slider position `step` (0…DURATION_STEPS). */
export function minutesForStep(step: number): number {
  let i = Math.round(step);
  if (i <= 0) return 0;
  if (i >= DURATION_STEPS) return 24 * 60;
  for (const band of BANDS) {
    if (i < band.steps) return band.from + i * band.stride;
    i -= band.steps;
  }
  return 24 * 60;
}

/** The detent nearest `minutes` — where the thumb goes for a stored value. */
export function stepForMinutes(minutes: number): number {
  const m = Math.max(0, Math.min(24 * 60, Math.round(minutes || 0)));
  let best = 0;
  let bestGap = Infinity;
  for (let i = 0; i <= DURATION_STEPS; i++) {
    const gap = Math.abs(minutesForStep(i) - m);
    // `<` not `<=`: ties keep the LOWER detent, so a value exactly between
    // two of them doesn't drift upward every time it round-trips.
    if (gap < bestGap) { bestGap = gap; best = i; }
    if (gap === 0) break;
  }
  return best;
}

/** "—", "25 min", "1h", "1h 35m" — the label over the slider. */
export function formatDuration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes || 0));
  if (!m) return '—';
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h}h ${rest}m` : `${h}h`;
}
