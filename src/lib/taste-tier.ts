/**
 * Taste tiers — the "how built-out is your palate" ladder.
 *
 * A taste profile only feels alive if it moves, and only feels earned if it
 * moves for reasons you can see. So the tier is a POINTS total with named
 * components, each with a plain "how to earn more" hint, and NONE of them
 * capped: there is always a next point to earn.
 *
 *   depth        how many places you've rated (log curve — the 300th
 *                rating says less than the 30th, but still says something)
 *   breadth      distinct cuisines, 3 each
 *   range        distinct cities, 4 each
 *   discernment  how much of the 0–10 scale you actually use (std-dev of
 *                your scores, ×20). A palate that puts everything at 8
 *                hasn't told us much; one that uses 4s and 9.5s has.
 *   voice        ratings with written notes, 1 each
 *   eye          photos attached — square-root curve, because photos are
 *                the one input that arrives in bulk (five per visit), and
 *                a linear rate would let a camera roll outweigh every
 *                cuisine and city combined
 *   detail       distinct tags applied, 1 each
 *   tenure       distinct months with a rating, 3 each — steady beats a binge
 *
 * Nothing here rewards being generous or being harsh, and nothing rewards
 * agreeing with the crowd: the ladder is about how much of YOUR taste is
 * on the record, not whether it is the "right" taste.
 *
 * ── THE FORMULA IS DUPLICATED IN SQL ──
 * supabase/migrations/083_taste_leaderboard.sql computes the same points
 * server-side so every user can be ranked without their private ratings
 * leaving the database. `tastePoints` and that migration MUST agree; the
 * test in taste-tier.test.ts pins the arithmetic with hand-checked values,
 * and the migration comment carries the same table. Change both or neither.
 */

import { cityFromAddress } from './city';
import { isUnknownCuisine } from './cuisine';

export interface TasteStats {
  ratingCount: number;
  cuisineCount: number;
  cityCount: number;
  noteCount: number;
  photoCount: number;
  tagCount: number;
  /** Population standard deviation of the user's scores (0 when < 2). */
  scoreSpread: number;
  /** Distinct calendar months (UTC) that have at least one rating. */
  monthCount: number;
}

export type PointsKey =
  | 'depth' | 'breadth' | 'range' | 'discernment' | 'voice' | 'eye' | 'detail' | 'tenure';

export interface PointsComponent {
  key: PointsKey;
  label: string;
  /** Unrounded — round only for display so the total stays exact. */
  points: number;
  /** The raw quantity behind the points ("14 cuisines"). */
  value: number;
  unit: string;
  /** The unit when value is exactly 1 ("1 city", not "1 citie"). */
  unitOne: string;
  /** How to earn more — the thing that makes the ladder climbable. */
  hint: string;
}

export interface TastePoints {
  total: number;
  components: PointsComponent[];
}

export function tastePoints(s: TasteStats): TastePoints {
  const n = Math.max(0, s.ratingCount);
  const c = (key: PointsKey, label: string, points: number, value: number, unit: string, unitOne: string, hint: string): PointsComponent => ({
    key, label, points: Math.max(0, points), value, unit, unitOne, hint,
  });
  const components: PointsComponent[] = [
    c('depth', 'Depth', 10 * Math.log1p(n), n, 'rated', 'rated', 'Every rating counts, early ones most'),
    c('breadth', 'Breadth', 3 * s.cuisineCount, s.cuisineCount, 'cuisines', 'cuisine', '+3 for every new cuisine'),
    c('range', 'Range', 4 * s.cityCount, s.cityCount, 'cities', 'city', '+4 for every new city'),
    c('discernment', 'Discernment', 20 * s.scoreSpread, Math.round(s.scoreSpread * 100) / 100, 'score spread', 'score spread', 'Use the whole scale — a 4 says as much as a 9'),
    c('voice', 'Voice', s.noteCount, s.noteCount, 'notes', 'note', '+1 for every rating with notes'),
    c('eye', 'Eye', 4 * Math.sqrt(Math.max(0, s.photoCount)), s.photoCount, 'photos', 'photo', 'Every photo counts, the first ones most'),
    c('detail', 'Detail', s.tagCount, s.tagCount, 'tags used', 'tag used', '+1 for every distinct tag'),
    c('tenure', 'Tenure', 3 * s.monthCount, s.monthCount, 'active months', 'active month', '+3 for every month you rate something'),
  ];
  const total = Math.round(components.reduce((sum, x) => sum + x.points, 0));
  return { total, components };
}

export interface TasteTier {
  key: 'newcomer' | 'regular' | 'explorer' | 'connoisseur' | 'critic' | 'legend';
  name: string;
  min: number;
  /** One line on what the tier says about you — sentence case, no hype. */
  blurb: string;
}

/** Rungs on an open-ended ladder. Legend has no ceiling — the emblem's
 *  ring is simply full from 650 on, and the points keep counting. */
export const TIERS: readonly TasteTier[] = [
  { key: 'newcomer', name: 'Newcomer', min: 0, blurb: 'A palate just starting to go on the record.' },
  { key: 'regular', name: 'Regular', min: 60, blurb: 'Enough ratings for the recommendations to take shape.' },
  { key: 'explorer', name: 'Explorer', min: 150, blurb: 'Breadth is showing — cuisines, cities, the whole scale.' },
  { key: 'connoisseur', name: 'Connoisseur', min: 280, blurb: 'A palate with clear opinions and the history to back them.' },
  { key: 'critic', name: 'Critic', min: 400, blurb: 'Written, photographed, tagged: a taste that is a body of work.' },
  { key: 'legend', name: 'Legend', min: 650, blurb: 'Few people have put this much of their taste on the record.' },
];

export interface TierStanding {
  tier: TasteTier;
  next: TasteTier | null;
  /** 0..1 progress from this tier's floor to the next tier's floor (1 at Legend). */
  progress: number;
  /** Points still needed for the next tier (0 at Legend). */
  toNext: number;
}

export function tierFor(points: number): TierStanding {
  const p = Math.max(0, points);
  let idx = 0;
  for (let i = 0; i < TIERS.length; i++) if (p >= TIERS[i].min) idx = i;
  const tier = TIERS[idx];
  const next = TIERS[idx + 1] ?? null;
  if (!next) return { tier, next: null, progress: 1, toNext: 0 };
  const span = next.min - tier.min;
  return {
    tier,
    next,
    progress: Math.max(0, Math.min(1, (p - tier.min) / span)),
    toNext: Math.max(0, next.min - p),
  };
}

/* ── Local stats ──────────────────────────────────────────────────────── */

export interface RatingForStats {
  score: number;
  cuisine?: string;
  address?: string;
  notes?: string;
  tags?: string[];
  photos?: unknown[];
  createdAt?: number;
}

/** Cuisine tokens the way the recommendation engine splits compound
 *  labels ("Korean, Contemporary" → two) — lower-cased for distinctness,
 *  with the Places-type leftovers older resolvers saved as cuisines
 *  ("Restaurant", "Food", "Establishment") dropped: they are not taste.
 *  Mirrored by the SQL regexp + exclusion list in migration 083. */
export function cuisineTokens(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw.split(/[,/]|\s&\s/)
    .map((s) => s.trim().toLowerCase())
    .filter((t) => t && !isUnknownCuisine(t));
}

/** The city of an address — lib/city's parser (country, state+zip and
 *  postcode stripping), lower-cased for distinct counting. Mirrored
 *  regex-for-regex by `taste_city_of` in migration 083. */
export function cityToken(address: string | undefined): string | null {
  const city = cityFromAddress(address).toLowerCase();
  return city || null;
}

export function populationStdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const v = values.reduce((sum, x) => sum + (x - mean) ** 2, 0) / values.length;
  return Math.sqrt(v);
}

/** Month key (UTC) for a timestamp — mirrored by to_char(... 'YYYY-MM'). */
export function monthKey(ts: number): string | null {
  if (!Number.isFinite(ts) || ts <= 0) return null;
  const d = new Date(ts);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * The stats behind the ladder, from the user's own local ratings. Used
 * before the server has answered (and for guests / projects without
 * migration 083), and for the per-component breakdown, which the server
 * also returns but this keeps live as you rate.
 */
export function statsFromRatings(ratings: RatingForStats[]): TasteStats {
  const cuisines = new Set<string>();
  const cities = new Set<string>();
  const tags = new Set<string>();
  const months = new Set<string>();
  const scores: number[] = [];
  let notes = 0;
  let photos = 0;
  for (const r of ratings) {
    if (typeof r.score === 'number' && r.score > 0) scores.push(r.score);
    for (const t of cuisineTokens(r.cuisine)) cuisines.add(t);
    const city = cityToken(r.address);
    if (city) cities.add(city);
    for (const t of r.tags ?? []) if (t) tags.add(t.trim().toLowerCase());
    if ((r.notes ?? '').trim()) notes++;
    photos += r.photos?.length ?? 0;
    const m = monthKey(r.createdAt ?? 0);
    if (m) months.add(m);
  }
  return {
    ratingCount: ratings.length,
    cuisineCount: cuisines.size,
    cityCount: cities.size,
    noteCount: notes,
    photoCount: photos,
    tagCount: tags.size,
    scoreSpread: populationStdDev(scores),
    monthCount: months.size,
  };
}
