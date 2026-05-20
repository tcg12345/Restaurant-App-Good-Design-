// Filter slice enumeration for the URR compute job.
//
// A "slice" is a pre-computed leaderboard for a specific filter combination
// (cuisine, city, price, or combinations thereof). Each slice produces its
// own ratings_data row in urr_ratings_cache.
//
// IMPORTANT: Score rescaling is PER-SLICE, not global. A restaurant at the
// 90th percentile within "Italian, NYC, $$" SHOULD score higher than the
// same restaurant at the 70th percentile of "overall" — the filter tightens
// the competitive pool. This is the central feature of the URR system. Do
// not "fix" this by switching to a global rescale.

import type { MatchInput, SliceCtx } from './elo.ts';

const TOP_N_CUISINE = 30;
const TOP_N_CITY = 30;
const MIN_MATCHES_PER_KEY = 10;

export interface SliceFilters {
  cuisine?: string;
  city?: string;
  price?: string;
}

export function parseSliceKey(key: string): SliceFilters {
  if (key === 'overall') return {};
  const out: SliceFilters = {};
  for (const part of key.split('|')) {
    const idx = part.indexOf(':');
    if (idx <= 0) continue;
    const dim = part.slice(0, idx);
    const val = part.slice(idx + 1);
    if (dim === 'cuisine') out.cuisine = val;
    else if (dim === 'city') out.city = val;
    else if (dim === 'price') out.price = val;
  }
  return out;
}

export function buildSliceKey(filters: SliceFilters): string {
  const parts: string[] = [];
  if (filters.cuisine) parts.push(`cuisine:${filters.cuisine}`);
  if (filters.city) parts.push(`city:${filters.city}`);
  if (filters.price) parts.push(`price:${filters.price}`);
  return parts.length === 0 ? 'overall' : parts.sort().join('|');
}

/** A match satisfies a slice iff BOTH winner and loser share every dim. */
export function matchSatisfies(match: MatchInput, filters: SliceFilters): boolean {
  const w = match.context_tags?.winner ?? {};
  const l = match.context_tags?.loser ?? {};
  if (filters.cuisine && (w.cuisine !== filters.cuisine || l.cuisine !== filters.cuisine)) return false;
  if (filters.city && (w.city !== filters.city || l.city !== filters.city)) return false;
  if (filters.price && (w.price !== filters.price || l.price !== filters.price)) return false;
  return true;
}

function bump(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function topN(counts: Map<string, number>, n: number, minMatches: number): string[] {
  return [...counts.entries()]
    .filter(([, c]) => c >= minMatches)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k]) => k);
}

/**
 * Decide which slices to compute. We always emit `overall`. Single-dim slices
 * are emitted for the top 30 cuisines / cities and all 4 price tiers (with a
 * minimum match threshold). Multi-dim slices are capped to keep the nightly
 * job tractable: top-10 × top-10 for cuisine × city, top-5 × top-5 × 4 prices
 * for cuisine × city × price.
 */
export function enumerateSlices(matches: MatchInput[]): string[] {
  const out = new Set<string>();
  out.add('overall');

  const cuisineCounts = new Map<string, number>();
  const cityCounts = new Map<string, number>();
  const priceCounts = new Map<string, number>();

  for (const m of matches) {
    for (const side of [m.context_tags?.winner, m.context_tags?.loser]) {
      if (!side) continue;
      if (side.cuisine) bump(cuisineCounts, side.cuisine);
      if (side.city) bump(cityCounts, side.city);
      if (side.price) bump(priceCounts, side.price);
    }
  }

  const cuisines = topN(cuisineCounts, TOP_N_CUISINE, MIN_MATCHES_PER_KEY);
  const cities = topN(cityCounts, TOP_N_CITY, MIN_MATCHES_PER_KEY);
  const prices = topN(priceCounts, 4, MIN_MATCHES_PER_KEY);

  for (const c of cuisines) out.add(buildSliceKey({ cuisine: c }));
  for (const c of cities) out.add(buildSliceKey({ city: c }));
  for (const p of prices) out.add(buildSliceKey({ price: p }));

  for (const cu of cuisines.slice(0, 10)) {
    for (const ci of cities.slice(0, 10)) {
      out.add(buildSliceKey({ cuisine: cu, city: ci }));
    }
  }

  for (const cu of cuisines.slice(0, 5)) {
    for (const ci of cities.slice(0, 5)) {
      for (const p of prices) {
        out.add(buildSliceKey({ cuisine: cu, city: ci, price: p }));
      }
    }
  }

  return [...out].sort();
}
