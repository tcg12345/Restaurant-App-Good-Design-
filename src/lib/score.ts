/**
 * Shared score-color helpers — THE one score-color system.
 *
 * Every place in the app that colour-codes a numeric score (chips, rings,
 * map markers, gradients) imports from here, and everything here reads the
 * `--color-score-*` tokens defined in src/index.css @theme (warm brand set,
 * with -tint / -ink variants that adapt in dark mode). Never hardcode the
 * tier hexes in a component — four competing palettes used to render the
 * same tier differently across detail pages, lists and maps.
 *
 * Thresholds are ≥8 high / ≥5 mid / <5 low everywhere.
 *
 * NOTE: class-returning helpers use FULL literal class strings (never
 * template-composed) so Tailwind's scanner can see and generate them.
 */

export type ScoreTier = 'high' | 'mid' | 'low';

export const scoreTier = (s: number): ScoreTier => (s >= 8 ? 'high' : s >= 5 ? 'mid' : 'low');

/** Literal hexes mirroring the index.css tokens — ONLY for contexts CSS
 *  variables can't reach (Mapbox GL paint, canvas, motion color tweens).
 *  DOM styles should use `scoreSolid` / the utility classes instead. */
export const SCORE_TIER_HEX: Record<ScoreTier, string> = {
  high: '#2E7D5C',
  mid: '#C28F3A',
  low: '#A8392A',
};

/** Literal tier hex for non-CSS contexts (map markers, canvas). */
export const scoreHex = (s: number): string => SCORE_TIER_HEX[scoreTier(s)];

/** Solid tier color as a token-backed CSS value, for inline styles. */
export const scoreSolid = (s: number): string => `var(--color-score-${scoreTier(s)})`;

/** Soft-tint chip classes: pale tier fill + readable tier text. */
export const scoreTint = (s: number): string =>
  s >= 8 ? 'bg-score-high-tint text-score-high-ink'
  : s >= 5 ? 'bg-score-mid-tint text-score-mid-ink'
  : 'bg-score-low-tint text-score-low-ink';

/** Inline-style pack for the soft tier chip (ScoreRing & friends):
 *  tint fill, tier ring color, readable text — all token-backed. */
export const scoreTintStyle = (s: number): { background: string; ring: string; color: string } => {
  const t = scoreTier(s);
  return {
    background: `var(--color-score-${t}-tint)`,
    ring: `color-mix(in srgb, var(--color-score-${t}) 55%, transparent)`,
    color: `var(--color-score-${t}-ink)`,
  };
};

/** Solid chip fill class (white text on top). */
export const scoreChipBg = (s: number): string =>
  s >= 8 ? 'bg-score-high' : s >= 5 ? 'bg-score-mid' : 'bg-score-low';

/** Diagonal gradient fill for hero score discs — tier color into a
 *  slightly darkened version of itself. */
export const scoreGradient = (s: number): string => {
  const t = scoreTier(s);
  return `linear-gradient(145deg, var(--color-score-${t}), color-mix(in srgb, var(--color-score-${t}) 78%, #000))`;
};

/** Standard text colour class for a score displayed on the app surface. */
export const scoreColor = (s: number): string =>
  s >= 8 ? 'text-score-high-ink' : s >= 5 ? 'text-score-mid-ink' : 'text-score-low-ink';

/** Lighter text colour for scores rendered on dark / gradient backgrounds
 *  (rating circles, media overlays) — same in both themes. */
export const scoreColorLight = (s: number): string =>
  s >= 8 ? 'text-score-high-bright' : s >= 5 ? 'text-score-mid-bright' : 'text-score-low-bright';

/** Ring colour for score indicator circles. */
export const scoreRingColor = (s: number): string =>
  s >= 8 ? 'ring-score-high/30' : s >= 5 ? 'ring-score-mid/30' : 'ring-score-low/30';

/** Gradient background for score indicator circles. */
export const scoreBgGradient = (s: number): string =>
  s >= 8 ? 'from-score-high/20 to-score-high/5'
  : s >= 5 ? 'from-score-mid/20 to-score-mid/5'
  : 'from-score-low/20 to-score-low/5';

/** Full-bleed gradient overlay (e.g. hero images on review detail). */
export const scoreGradientOverlay = (s: number): string =>
  s >= 8 ? 'from-score-high/20 to-score-high/0'
  : s >= 5 ? 'from-score-mid/20 to-score-mid/0'
  : 'from-score-low/20 to-score-low/0';

/** Ring colour for score badges with stronger opacity. */
export const scoreRingStrong = (s: number): string =>
  s >= 8 ? 'ring-score-high/40' : s >= 5 ? 'ring-score-mid/40' : 'ring-score-low/40';

/** Small solid dot / pip background. */
export const scoreDotBg = (s: number): string =>
  s >= 8 ? 'bg-score-high' : s >= 5 ? 'bg-score-mid' : 'bg-score-low';

/** Badge / chip background with border (e.g. circle activity cards). */
export const scoreBadgeBg = (s: number): string =>
  s >= 8 ? 'bg-score-high-tint border-score-high/25'
  : s >= 5 ? 'bg-score-mid-tint border-score-mid/25'
  : 'bg-score-low-tint border-score-low/25';
