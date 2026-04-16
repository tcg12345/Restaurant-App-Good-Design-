/**
 * Shared score-color helpers.
 *
 * Every place in the app that colour-codes a numeric score (green / yellow / red)
 * should import from here so the thresholds and palette stay in one place.
 */

/** Standard text colour class for a score displayed on a light background. */
export const scoreColor = (s: number): string =>
  s >= 8 ? 'text-green-600' : s >= 5 ? 'text-yellow-600' : 'text-red-500';

/** Lighter text colour for scores rendered on dark / gradient backgrounds (e.g. rating circles). */
export const scoreColorLight = (s: number): string =>
  s >= 8 ? 'text-green-400' : s >= 5 ? 'text-yellow-400' : 'text-red-400';

/** Ring colour for score indicator circles. */
export const scoreRingColor = (s: number): string =>
  s >= 8 ? 'ring-green-400/30' : s >= 5 ? 'ring-yellow-400/30' : 'ring-red-400/30';

/** Gradient background for score indicator circles. */
export const scoreBgGradient = (s: number): string =>
  s >= 8 ? 'from-green-500/20 to-green-600/5' : s >= 5 ? 'from-yellow-500/20 to-yellow-600/5' : 'from-red-500/20 to-red-600/5';

/** Full-bleed gradient overlay (e.g. hero images on review detail). */
export const scoreGradientOverlay = (s: number): string =>
  s >= 8
    ? 'from-green-500/20 to-green-500/0'
    : s >= 5
      ? 'from-yellow-500/20 to-yellow-500/0'
      : 'from-red-500/20 to-red-500/0';

/** Ring colour for score badges with stronger opacity. */
export const scoreRingStrong = (s: number): string =>
  s >= 8 ? 'ring-green-500/40' : s >= 5 ? 'ring-yellow-500/40' : 'ring-red-500/40';

/** Small solid dot / pip background. */
export const scoreDotBg = (s: number): string =>
  s >= 8 ? 'bg-green-500' : s >= 5 ? 'bg-yellow-500' : 'bg-red-500';

/** Badge / chip background with border (e.g. circle activity cards). */
export const scoreBadgeBg = (s: number): string =>
  s >= 8 ? 'bg-green-50 border-green-200' : s >= 5 ? 'bg-yellow-50 border-yellow-200' : 'bg-red-50 border-red-200';
