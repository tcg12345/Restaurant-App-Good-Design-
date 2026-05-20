// Pure functional Elo for URR. Tested in isolation by elo.test.ts.

export const ELO_BASE = 1500;
export const SCALE = 400;
export const K_BASE = 32;
export const K_FLOOR = 8;
export const EXPERIENCE_TARGET = 50;
export const EXPERIENCED_THRESHOLD = 0.5;
export const RESCALE_STEEPNESS = 1.8;

export interface MatchInput {
  user_id: string;
  winner_restaurant_id: string;
  loser_restaurant_id: string;
  margin: number;
  context_tags: { winner: SliceCtx; loser: SliceCtx };
  source: string;
  created_at: string;
}

export interface SliceCtx {
  cuisine?: string;
  price?: string;
  city?: string;
  neighborhood?: string;
  lat?: number;
  lng?: number;
}

export interface RestaurantStats {
  rating: number;
  n_matches: number;
  raters: Set<string>;
  experienced_raters: Set<string>;
}

export function newStats(): RestaurantStats {
  return { rating: ELO_BASE, n_matches: 0, raters: new Set(), experienced_raters: new Set() };
}

export function expectedWinner(rWinner: number, rLoser: number): number {
  return 1 / (1 + Math.pow(10, (rLoser - rWinner) / SCALE));
}

export function decayK(nw: number, nl: number): number {
  const avg = (nw + nl) / 2;
  return K_FLOOR + (K_BASE - K_FLOOR) * Math.exp(-avg / 30);
}

/**
 * Apply one match to the running stats map in place. Caller is responsible
 * for filtering the match to the slice — this function does not check
 * matchSatisfies.
 */
export function applyMatch(
  stats: Map<string, RestaurantStats>,
  match: MatchInput,
  experience: Map<string, number>,
): void {
  const w = stats.get(match.winner_restaurant_id) ?? newStats();
  const l = stats.get(match.loser_restaurant_id) ?? newStats();

  const k = decayK(w.n_matches, l.n_matches);
  const exp = experience.get(match.user_id) ?? 0.1;
  const wExp = Math.max(exp, 0.1);

  const eW = expectedWinner(w.rating, l.rating);
  const eL = 1 - eW;
  const aW = match.margin;
  const aL = 1 - match.margin;

  w.rating += k * wExp * (aW - eW);
  l.rating += k * wExp * (aL - eL);
  w.n_matches += 1;
  l.n_matches += 1;
  w.raters.add(match.user_id);
  l.raters.add(match.user_id);
  if (exp >= EXPERIENCED_THRESHOLD) {
    w.experienced_raters.add(match.user_id);
    l.experienced_raters.add(match.user_id);
  }

  stats.set(match.winner_restaurant_id, w);
  stats.set(match.loser_restaurant_id, l);
}

/**
 * Logistic mapping from percentile p ∈ [0,1] to a 0-10 score.
 * ~4.0 at p=0.01, ~7.0 at p=0.5, ~9.5 at p=0.95.
 */
export function rescaleScore(percentile: number): number {
  const clamped = Math.max(0, Math.min(1, percentile));
  return 4.0 + 6.0 / (1 + Math.exp(-RESCALE_STEEPNESS * (clamped - 0.5)));
}

/**
 * Empirical CDF: fraction of elos strictly less than `value`, plus half the
 * fraction equal to value (Hazen's rule — avoids 0/1 endpoint values).
 * `elos` must be sorted ascending.
 */
export function empiricalCdf(value: number, sortedElos: number[]): number {
  const n = sortedElos.length;
  if (n === 0) return 0.5;
  if (n === 1) return 0.5;
  let l = 0;
  let r = n;
  while (l < r) {
    const m = (l + r) >>> 1;
    if (sortedElos[m] < value) l = m + 1;
    else r = m;
  }
  const firstGe = l;
  l = 0;
  r = n;
  while (l < r) {
    const m = (l + r) >>> 1;
    if (sortedElos[m] <= value) l = m + 1;
    else r = m;
  }
  const firstGt = l;
  return (firstGe + (firstGt - firstGe) / 2) / n;
}
