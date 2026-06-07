/**
 * Restaurant similarity scoring — pure logic, no React.
 *
 * Turns two restaurants' attributes (location, cuisine, price, tags) into a
 * single [0,1] relevance score. The head-to-head engine uses this to choose
 * comparisons the user can actually reason about ("this Italian spot vs. that
 * one in the same city") instead of arbitrary midpoints.
 *
 * Design rules:
 *  - Every component degrades gracefully: a missing signal drops out of the
 *    blend and the remaining weights renormalize. Nothing throws.
 *  - All-missing → a neutral score, so the engine falls back to plain
 *    bisection (no relevance signal to act on).
 *  - Deterministic: no randomness, no clocks.
 */

import { haversineDistanceMi } from './distance';
import { extractCityState } from './places';

export interface SimilarityInput {
  /** Single cuisine label (may be ''). */
  cuisine: string;
  /** Price as "$".."$$$$" (or '' when unknown). */
  price: string;
  /** Free-text address — used to derive a city/metro band. */
  address: string;
  /** Precomputed extractCityState(address); derived on demand when absent. */
  city?: string;
  /** Mapbox-sourced neighborhood, when known. */
  neighborhood?: string;
  lat?: number;
  lng?: number;
  /** Free-form descriptor tags (e.g. "Romantic", "Great cocktails"). */
  tags?: string[];
}

export interface SimilarityResult {
  /** Blended relevance in [0,1]. */
  score: number;
  /** Which components contributed to the blend. */
  present: { location: boolean; cuisine: boolean; price: boolean; tags: boolean };
  /** Per-component sub-scores (only for present components) — for the hint. */
  parts: { location?: number; cuisine?: number; price?: number; tags?: number };
}

/* ── Tunables ──────────────────────────────────────────────────────────── */

/** Top-level component weights (renormalized over whichever are present).
 *  Location is intentionally the dominant signal: a restaurant in the same
 *  city/neighborhood is the most useful thing to compare against, so it should
 *  outweigh a same-cuisine match somewhere across the country. */
export const SIMILARITY_WEIGHTS = {
  location: 0.45,
  cuisine: 0.25,
  price: 0.15,
  tags: 0.15,
} as const;

/** Location sub-weights when both restaurants have coordinates. */
export const LOCATION_SUBWEIGHTS = {
  distance: 0.6,
  city: 0.25,
  neighborhood: 0.15,
} as const;

/** Location sub-weights when we only have city/neighborhood strings. */
export const LOCATION_SUBWEIGHTS_NO_COORDS = {
  city: 0.7,
  neighborhood: 0.3,
} as const;

/** Miles at which the distance signal decays to 1/e (~0.37). */
export const DISTANCE_DECAY_MILES = 8;
/** Below this many miles apart (no city match), the hint reads "Nearby". */
export const NEARBY_MILES = 1.5;
/** Partial credit for cuisines that are related but not identical. */
export const CUISINE_RELATED_CREDIT = 0.5;
/** Score returned when no component is available — drives bisection fallback. */
export const NEUTRAL_SIMILARITY = 0.5;
/** A candidate at or above this similarity is treated as a "peer". */
export const PEER_SIMILARITY_THRESHOLD = 0.55;

/**
 * Related-cuisine clusters. Membership is transitive *within* a cluster only:
 * any two labels sharing a cluster earn partial cuisine credit. A label may
 * live in several clusters (e.g. BBQ is both Korean and American comfort).
 * Keyed by the human labels from CUISINE_TYPES (places.ts).
 */
const CUISINE_CLUSTERS: string[][] = [
  ['Japanese', 'Sushi', 'Ramen', 'Noodle'],
  ['Chinese', 'Dim Sum', 'Hot Pot', 'Noodle'],
  ['Korean', 'BBQ', 'Asian'],
  ['Thai', 'Vietnamese', 'Malaysian', 'Indonesian', 'Filipino'],
  ['Asian', 'Asian Fusion', 'Chinese', 'Thai', 'Japanese'],
  ['Mediterranean', 'Greek', 'Middle Eastern', 'Lebanese', 'Turkish', 'Kebab', 'Halal', 'Moroccan'],
  ['Mexican', 'Tex-Mex', 'Taco', 'Latin American', 'Cuban'],
  ['Latin American', 'Peruvian', 'Brazilian', 'Cuban', 'Spanish'],
  ['Spanish', 'Tapas', 'Portuguese'],
  ['Italian', 'Pizza'],
  ['American', 'Burgers', 'BBQ', 'Diner', 'Southern', 'Soul Food', 'Fried Chicken', 'Steakhouse', 'Bar & Grill'],
  ['Bar', 'Pub', 'Wine Bar', 'Bar & Grill', 'Tapas'],
  ['Cafe', 'Coffee Shop', 'Bakery', 'Tea House', 'Bagel Shop', 'Donuts'],
  ['Breakfast', 'Brunch', 'Diner', 'Cafe', 'Bagel Shop'],
  ['Dessert', 'Ice Cream', 'Bakery', 'Donuts'],
  ['Sandwich', 'Deli', 'Bagel Shop'],
  ['Fast Food', 'Burgers', 'Fried Chicken'],
  ['French', 'Fine Dining', 'Steakhouse'],
  ['Salad', 'Vegan', 'Vegetarian', 'Juice Bar'],
  ['Seafood', 'Hawaiian'],
];

/** label(lowercased) → set of related labels(lowercased). Built once. */
export const RELATED_CUISINES: Record<string, Set<string>> = buildRelatedCuisines(CUISINE_CLUSTERS);

function buildRelatedCuisines(clusters: string[][]): Record<string, Set<string>> {
  const map: Record<string, Set<string>> = {};
  const add = (a: string, b: string) => {
    const key = a.toLowerCase();
    (map[key] ??= new Set()).add(b.toLowerCase());
  };
  for (const cluster of clusters) {
    for (const a of cluster) {
      for (const b of cluster) {
        if (a !== b) add(a, b);
      }
    }
  }
  return map;
}

function areCuisinesRelated(a: string, b: string): boolean {
  return RELATED_CUISINES[a]?.has(b) ?? false;
}

/* ── Helpers ───────────────────────────────────────────────────────────── */

function isFiniteCoord(v: number | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function priceTier(price: string): number {
  // "$".."$$$$" → 1..4; clamp defensively. 0 means unknown.
  const n = (price || '').length;
  return Math.max(0, Math.min(4, n));
}

function cityOf(input: SimilarityInput): string {
  const c = (input.city ?? extractCityState(input.address || '')) || '';
  return c.trim().toLowerCase();
}

function normTags(tags: string[] | undefined): Set<string> {
  const out = new Set<string>();
  for (const t of tags || []) {
    const v = t.trim().toLowerCase();
    if (v) out.add(v);
  }
  return out;
}

/* ── Component sub-scores ──────────────────────────────────────────────── */

interface LocationEval {
  present: boolean;
  score: number;
  cityMatch: boolean;
  nbhdMatch: boolean;
  miles: number | null;
}

function evalLocation(a: SimilarityInput, b: SimilarityInput): LocationEval {
  const coordsA = isFiniteCoord(a.lat) && isFiniteCoord(a.lng);
  const coordsB = isFiniteCoord(b.lat) && isFiniteCoord(b.lng);

  const cityA = cityOf(a);
  const cityB = cityOf(b);
  const cityKnown = !!cityA && !!cityB;
  const cityMatch = cityKnown && cityA === cityB;

  const nbhdA = (a.neighborhood || '').trim().toLowerCase();
  const nbhdB = (b.neighborhood || '').trim().toLowerCase();
  const nbhdKnown = !!nbhdA && !!nbhdB;
  const nbhdMatch = nbhdKnown && nbhdA === nbhdB;

  if (coordsA && coordsB) {
    const miles = haversineDistanceMi(a.lat!, a.lng!, b.lat!, b.lng!);
    const distScore = Math.exp(-miles / DISTANCE_DECAY_MILES);
    let num = LOCATION_SUBWEIGHTS.distance * distScore;
    let den = LOCATION_SUBWEIGHTS.distance;
    if (cityKnown) {
      num += LOCATION_SUBWEIGHTS.city * (cityMatch ? 1 : 0);
      den += LOCATION_SUBWEIGHTS.city;
    }
    if (nbhdKnown) {
      num += LOCATION_SUBWEIGHTS.neighborhood * (nbhdMatch ? 1 : 0);
      den += LOCATION_SUBWEIGHTS.neighborhood;
    }
    return { present: true, score: num / den, cityMatch, nbhdMatch, miles };
  }

  if (cityKnown || nbhdKnown) {
    let num = 0;
    let den = 0;
    if (cityKnown) {
      num += LOCATION_SUBWEIGHTS_NO_COORDS.city * (cityMatch ? 1 : 0);
      den += LOCATION_SUBWEIGHTS_NO_COORDS.city;
    }
    if (nbhdKnown) {
      num += LOCATION_SUBWEIGHTS_NO_COORDS.neighborhood * (nbhdMatch ? 1 : 0);
      den += LOCATION_SUBWEIGHTS_NO_COORDS.neighborhood;
    }
    return { present: den > 0, score: den > 0 ? num / den : 0, cityMatch, nbhdMatch, miles: null };
  }

  return { present: false, score: 0, cityMatch: false, nbhdMatch: false, miles: null };
}

interface CuisineEval { present: boolean; score: number; exact: boolean; related: boolean; }

function evalCuisine(a: SimilarityInput, b: SimilarityInput): CuisineEval {
  const ca = (a.cuisine || '').trim().toLowerCase();
  const cb = (b.cuisine || '').trim().toLowerCase();
  if (!ca || !cb) return { present: false, score: 0, exact: false, related: false };
  if (ca === cb) return { present: true, score: 1, exact: true, related: false };
  if (areCuisinesRelated(ca, cb)) {
    return { present: true, score: CUISINE_RELATED_CREDIT, exact: false, related: true };
  }
  return { present: true, score: 0, exact: false, related: false };
}

interface PriceEval { present: boolean; score: number; exact: boolean; }

function evalPrice(a: SimilarityInput, b: SimilarityInput): PriceEval {
  const pa = priceTier(a.price);
  const pb = priceTier(b.price);
  if (pa < 1 || pb < 1) return { present: false, score: 0, exact: false };
  return { present: true, score: 1 - Math.abs(pa - pb) / 4, exact: pa === pb };
}

interface TagEval { present: boolean; score: number; shared: string[]; }

function evalTags(a: SimilarityInput, b: SimilarityInput): TagEval {
  const ta = normTags(a.tags);
  const tb = normTags(b.tags);
  if (ta.size === 0 || tb.size === 0) return { present: false, score: 0, shared: [] };
  const shared: string[] = [];
  for (const t of ta) if (tb.has(t)) shared.push(t);
  const union = new Set([...ta, ...tb]).size;
  return { present: true, score: union > 0 ? shared.length / union : 0, shared };
}

/* ── Public API ────────────────────────────────────────────────────────── */

/** Blended similarity in [0,1]. Never throws; missing components renormalize. */
export function computeSimilarity(target: SimilarityInput, candidate: SimilarityInput): SimilarityResult {
  const loc = evalLocation(target, candidate);
  const cui = evalCuisine(target, candidate);
  const pri = evalPrice(target, candidate);
  const tag = evalTags(target, candidate);

  let num = 0;
  let den = 0;
  if (loc.present) { num += SIMILARITY_WEIGHTS.location * loc.score; den += SIMILARITY_WEIGHTS.location; }
  if (cui.present) { num += SIMILARITY_WEIGHTS.cuisine * cui.score; den += SIMILARITY_WEIGHTS.cuisine; }
  if (pri.present) { num += SIMILARITY_WEIGHTS.price * pri.score; den += SIMILARITY_WEIGHTS.price; }
  if (tag.present) { num += SIMILARITY_WEIGHTS.tags * tag.score; den += SIMILARITY_WEIGHTS.tags; }

  const score = den > 0 ? num / den : NEUTRAL_SIMILARITY;

  return {
    score,
    present: { location: loc.present, cuisine: cui.present, price: pri.present, tags: tag.present },
    parts: {
      location: loc.present ? loc.score : undefined,
      cuisine: cui.present ? cui.score : undefined,
      price: pri.present ? pri.score : undefined,
      tags: tag.present ? tag.score : undefined,
    },
  };
}

/**
 * Short, human "why is this relevant" line — only positive matches, max three
 * segments, ordered location → cuisine → price → tags. Returns '' when nothing
 * matches so callers can render conditionally with `&&`.
 */
export function relevanceHint(target: SimilarityInput, candidate: SimilarityInput): string {
  const segments: string[] = [];

  const loc = evalLocation(target, candidate);
  if (loc.nbhdMatch) segments.push('Same neighborhood');
  else if (loc.cityMatch) segments.push('Same city');
  else if (loc.miles != null && loc.miles <= NEARBY_MILES) segments.push('Nearby');

  const cui = evalCuisine(target, candidate);
  if (cui.exact && candidate.cuisine) segments.push(candidate.cuisine);
  else if (cui.related) segments.push('Similar cuisine');

  const pri = evalPrice(target, candidate);
  if (pri.exact && candidate.price) segments.push(candidate.price);

  const tag = evalTags(target, candidate);
  if (tag.shared.length > 0) {
    // Surface the candidate's original-cased tag for the first shared match.
    const first = tag.shared[0];
    const original = (candidate.tags || []).find((t) => t.trim().toLowerCase() === first) || first;
    segments.push(original);
  }

  return segments.slice(0, 3).join(' · ');
}
