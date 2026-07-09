import type { PlaceResult } from './places';
import { extractCityState, CUISINE_TYPES, searchPlacesByText, searchPlacesByTextPaged, isFoodPlace } from './places';
import type { CommunityRating } from './supabase-community';
import {
  getExpertRatings,
  getAllFriendRatings,
  getExpertProfiles,
  getTagSimilarRestaurants,
  getFollowedExpertIds,
  getCommunityPricesForPlaces,
  getCommunityRatingCounts,
} from './supabase-community';
import { locationKey, preferencesHash, getHomeRecsCache, saveHomeRecsCache } from './supabase-rec-cache';
import type { RestaurantRating, WishlistItem, CustomList } from '../contexts/ListsContext';
import {
  ensureMichelinIndex,
  findMichelinMatchSync,
  michelinNearbySync,
  michelinToPlaceResult,
  isMichelinSyntheticId,
  isMichelinIndexReady,
  normalize as normalizeName,
  type MichelinInfo,
} from './michelin';
import { haversineDistanceMi } from './distance';

export interface TasteProfile {
  cuisineScore: Record<string, number>;
  priceScore: Record<number, number>;
  priceCounts: Record<number, number>;       // legacy alias for priceScore (Map.tsx consumers)
  pairScore: Record<string, number>;         // "cuisine|price"
  tagScore: Record<string, number>;
  cityScore: Record<string, number>;
  topCuisines: string[];
  topPrices: number[];
  topPairs: { cuisine: string; price: number }[];
  topTags: string[];
  topCities: string[];
  topCity: string | null;                    // first element of topCities, or null
  highRatedCount: number;
  ratedIds: Set<string>;
  wishlistedIds: Set<string>;
  recentlyViewedIds: Set<string>;
  /** The user's mean rating (0 when they haven't rated anything). Affinity
   *  weights center on this (shrunk toward 7) so a tough grader's 6.5 and an
   *  easy grader's 8.5 both read as "above their bar". */
  avgScore: number;
  /** Own score per rated restaurant — powers friend taste-similarity, which
   *  weighs a friend's opinion by how often you two have agreed. */
  myScoreById: Map<string, number>;
  /** Where the user's money actually goes: positive-weight share per price
   *  tier, its center of mass, and how concentrated it is. Drives the price
   *  fit term and the price-restricted candidate queries. */
  priceDist?: {
    share: [number, number, number, number]; // index 0 = tier 1 ($)
    center: number;        // μ = Σ tier·share
    sigma: number;         // spread of the distribution
    concentration: number; // 0..1 — high = spends in a narrow band, trusted with volume
    n: number;             // positively-weighted priced ratings behind it
  };
  /** 0..1 — how much this palate skews distinctive (premium tiers + breadth
   *  of cuisines). Scales the Michelin/boutique boost and dampens raw
   *  popularity for users who clearly don't chase crowds. */
  distinctiveTaste?: number;
  /** The shrunk personal mean the affinity weights center on — exposed so the
   *  predicted score speaks the user's own scale. */
  anchor?: number;
  /** 90th percentile of the user's own scores (undefined under 8 ratings) —
   *  caps predictions so we never promise above their realistic ceiling. */
  scoreP90?: number;
  /** normalize()d names of every rated restaurant — suppresses Michelin
   *  synthetic candidates that duplicate an already-rated place under a
   *  different id. */
  ratedNames?: Set<string>;
  /** Share of the user's positively-weighted ratings that match each Michelin
   *  distinction bucket. Only computed once the dataset has loaded (the
   *  builder is sync); a heavy star-chaser gets starred candidates boosted,
   *  a Bib hunter gets Bibs. */
  michelinTaste?: { starShare: number; bibShare: number; selectedShare: number };
}

export interface RecTargetLocation {
  label: string;        // "Los Angeles, CA" (may be empty for "Current Location")
  lat: number;
  lng: number;
}

export interface RecOptions {
  userId: string | null;
  profile: TasteProfile;
  target: RecTargetLocation;
  radiusMeters: number;           // scopes Google queries and post-filters all pools
  signal?: AbortSignal;
  /** Ranked results to return. Default 12; the full recs browser asks for ~60. */
  limit?: number;
  /** Google text queries per fresh fetch. Default 5; more = wider pool. */
  maxQueries?: number;
  /** Keep wishlisted places in the ranking (they get an "On your wishlist"
   *  reason chip instead of being hidden — a wishlisted spot IS a good rec). */
  keepWishlisted?: boolean;
  /** Hard-drop price tiers the user demonstrably never spends in (see
   *  ScoreCandidatesOptions.enforcePriceBand). Default true here — this is
   *  the recommendation entry point, not a browse surface. */
  enforcePriceBand?: boolean;
}

/** A candidate entering the scorer. Michelin info and the in-app community
 *  rating count (when the pool stage found them) ride along so scoring stays
 *  synchronous and dataset-free. */
export interface RecCandidate extends PlaceResult {
  michelin?: { stars: 0 | 1 | 2 | 3; bibGourmand: boolean; selected: boolean };
  /** Distinct app users who have rated this place — the platform-popularity
   *  signal. Near-zero today; grows with the community. */
  appRatingCount?: number;
}

export interface ScoredPlace extends RecCandidate {
  recScore: number;
  sources: Array<'google' | 'tagSimilar' | 'expert' | 'friend' | 'expertRec' | 'michelin'>;
  /** Human-readable "why this" chips, strongest factor first (≤3). Absent on
   *  legacy call sites that fabricate ScoredPlace literals. */
  reasons?: string[];
  /** Beli-style prediction of the score THIS user would give the place, on
   *  their own 0–10 scale (one decimal, floor 5.0). Replaces the old match %. */
  predicted?: number;
}

/**
 * Every factor below is normalized to [-1, 1] before its weight is applied
 * (see scoreCandidates), so these are directly comparable: taste-pair match
 * and a like-minded friend's rave are the loudest signals, quality/cuisine
 * next, popularity is a mild tiebreaker.
 */
export const DEFAULT_WEIGHTS = {
  cuisine: 1.6,
  price: 0.9,              // base — grows up to 2.0 with price concentration
  pair: 1.8,
  tagOverlap: 1.1,
  popularity: 0.5,         // Google crowds — dampened as distinctiveTaste rises
  appPopularity: 0.8,      // in-app raters; saturates at ~20 (dormant until the community grows)
  quality: 1.5,
  distinctive: 1.4,        // Michelin / boutique boost, scaled by the palate
  michelinTaste: 1.0,      // extra lift when the user demonstrably chases that distinction
  expert: 1.0,
  friend: 1.6,
  wishlist: 0.6,
  distance: 1.2,           // max penalty for landing well past the radius edge
  negativeMult: 1.5,       // disliked cuisines/pairs push down harder than likes lift
} as const;

/** "Korean, Contemporary" / "Sushi / Japanese" → ["Korean","Contemporary"] … */
function splitCuisines(raw: string): string[] {
  if (!raw) return [];
  return raw.split(/[,/]|\s&\s/).map((s) => s.trim()).filter(Boolean);
}

export function buildTasteProfile(
  ratings: RestaurantRating[],
  wishlist: WishlistItem[],
  lists: CustomList[],
  recentViews: Array<{ id: string }>,
): TasteProfile {
  const cuisineScore: Record<string, number> = {};
  const priceScore: Record<number, number> = {};
  const pairScore: Record<string, number> = {};
  const tagScore: Record<string, number> = {};
  const cityScore: Record<string, number> = {};
  const myScoreById = new Map<string, number>();
  let highRatedCount = 0;

  // Personal anchor: the user's own mean, shrunk toward 7 so tiny samples
  // don't overreact. A tough grader's 6.5 counts as praise; a generous
  // grader's 7.5 doesn't.
  let scoreSum = 0;
  let scoreN = 0;
  for (const r of ratings) {
    if (r.score <= 0) continue;
    scoreSum += r.score;
    scoreN++;
  }
  const avgScore = scoreN > 0 ? scoreSum / scoreN : 0;
  const anchor = scoreN > 0 ? (scoreSum + 7 * 5) / (scoreN + 5) : 7;
  const now = Date.now();

  // Accumulators for the price distribution / distinctive-taste stats —
  // positive-weight side only, so they describe where the user's enthusiasm
  // actually goes rather than every place they've merely been.
  const priceMass: [number, number, number, number] = [0, 0, 0, 0];
  let pricedPositiveN = 0;
  const positiveCuisines = new Set<string>();
  const positiveScores: number[] = [];
  const ratedNames = new Set<string>();

  for (const r of ratings) {
    if (r.score <= 0) continue;
    myScoreById.set(r.restaurantId, r.score);
    if (r.name) ratedNames.add(normalizeName(r.name));
    const centered = r.score - anchor;
    let weight = centered >= 0 ? centered + 1 : centered * 1.25;

    // Recency: 18-month half-life on when the rating was logged, floored so
    // old favorites fade but never vanish — tastes drift, they don't reset.
    const ageDays = r.createdAt > 0 ? Math.max(0, (now - r.createdAt) / 86_400_000) : 0;
    const recency = Math.max(0.35, Math.pow(0.5, ageDays / 540));
    // wouldReturn is the strongest single bit we collect: a high score they
    // WOULDN'T repeat is a novelty, not a taste anchor; a low score they'd
    // still return to isn't a real dislike.
    const returnMult = centered >= 0
      ? (r.wouldReturn ? 1.15 : 0.6)
      : (r.wouldReturn ? 0.6 : 1.25);
    weight *= recency * returnMult;

    const price = r.price.length;

    // Ratings often carry compound labels ("Korean, Contemporary"); credit
    // every token so they match candidates' single inferred cuisine labels.
    for (const token of splitCuisines(r.cuisine)) {
      cuisineScore[token] = (cuisineScore[token] || 0) + weight;
      if (price > 0) {
        const key = `${token}|${price}`;
        pairScore[key] = (pairScore[key] || 0) + weight * 1.5;
      }
    }

    for (const tag of r.tags) {
      tagScore[tag] = (tagScore[tag] || 0) + weight * 0.75;
    }

    if (price > 0) {
      priceScore[price] = (priceScore[price] || 0) + weight;
    }
    if (weight > 0) {
      positiveScores.push(r.score);
      for (const token of splitCuisines(r.cuisine)) positiveCuisines.add(token);
      if (price >= 1 && price <= 4) {
        priceMass[price - 1] += weight;
        pricedPositiveN++;
      }
    }

    const city = extractCityState(r.address, r.address);
    if (city) {
      cityScore[city] = (cityScore[city] || 0) + Math.max(weight, 0);
    }

    if (r.score >= 8) highRatedCount++;
  }

  // Wishlisting is declared intent — a mild positive on the cuisine even when
  // the price is unknown (the old `cuisine && price` guard silently dropped
  // every priceless wishlist row).
  for (const w of wishlist) {
    const price = w.price.length;
    for (const token of splitCuisines(w.cuisine)) {
      cuisineScore[token] = (cuisineScore[token] || 0) + 0.5;
      if (price > 0) {
        const key = `${token}|${price}`;
        pairScore[key] = (pairScore[key] || 0) + 0.375;
      }
    }
    if (price > 0) {
      priceScore[price] = (priceScore[price] || 0) + 0.25;
    }
  }

  const LIST_TAG_MAP: Record<string, string> = {
    'Date Nights': 'Date Night',
    'Best Cocktails': 'Cocktails',
    'Hidden Gems': 'Hidden Gem',
    'Quick Bites': 'Quick Bite',
  };
  for (const list of lists) {
    const tag = LIST_TAG_MAP[list.name];
    if (tag && list.restaurantIds.length >= 1) {
      tagScore[tag] = (tagScore[tag] || 0) + 0.5;
    }
  }

  const topCuisines = Object.entries(cuisineScore)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([k]) => k);

  const topPrices = Object.entries(priceScore)
    .map(([k, v]) => [Number(k), v] as [number, number])
    .filter(([k, v]) => v > 0 && k >= 1 && k <= 4)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([k]) => k);

  const topPairs = Object.entries(pairScore)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([k]) => {
      const [cuisine, priceStr] = k.split('|');
      return { cuisine, price: Number(priceStr) };
    });

  const topTags = Object.entries(tagScore)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([k]) => k);

  const topCities = Object.entries(cityScore)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k]) => k);

  const ratedIds = new Set(ratings.map((r) => r.restaurantId));
  const wishlistedIds = new Set(wishlist.map((w) => w.restaurantId));
  const recentlyViewedIds = new Set(recentViews.map((v) => v.id));

  // ── Price distribution ──
  // Wishlist mass is deliberately excluded: declared intent isn't proven
  // spend, and it's exactly what would water a premium profile back down.
  const totalMass = priceMass[0] + priceMass[1] + priceMass[2] + priceMass[3];
  let priceDist: TasteProfile['priceDist'];
  if (totalMass > 0) {
    const share = priceMass.map((m) => m / totalMass) as [number, number, number, number];
    const center = share.reduce((sum, s, i) => sum + s * (i + 1), 0);
    const sigma = Math.sqrt(share.reduce((sum, s, i) => sum + s * (i + 1 - center) ** 2, 0));
    const confidence = pricedPositiveN / (pricedPositiveN + 6);
    const concentration = Math.max(0, Math.min(1, 1 - sigma / 1.5)) * confidence;
    priceDist = { share, center, sigma, concentration, n: pricedPositiveN };
  }

  // ── Distinctive taste ──
  // Premium share carries most of it; cuisine breadth adds the "explores
  // beyond the obvious" dash. Confidence-scaled like concentration.
  const premiumShare = totalMass > 0 ? (priceMass[2] + priceMass[3]) / totalMass : 0;
  const breadth = Math.max(0, Math.min(1, (positiveCuisines.size - 3) / 9));
  const distinctiveTaste =
    Math.max(0, Math.min(1, 0.75 * premiumShare + 0.25 * breadth)) *
    (pricedPositiveN / (pricedPositiveN + 6));

  const scoreP90 = positiveScores.length >= 8
    ? [...positiveScores].sort((a, b) => a - b)[Math.floor((positiveScores.length - 1) * 0.9)]
    : undefined;

  // ── Michelin taste ──
  // How much of the user's (positive) history is Guide-recognized, split by
  // distinction. Sync-gated on the dataset being loaded: the recs browser
  // loads it during the pool gather and rebuilds the profile when it lands;
  // other callers simply skip the boost until then. Name+city matching (the
  // rating rows carry no coords).
  let michelinTaste: TasteProfile['michelinTaste'];
  if (isMichelinIndexReady() && scoreN > 0) {
    let starHits = 0;
    let bibHits = 0;
    let selectedHits = 0;
    let positiveN = 0;
    for (const r of ratings) {
      if (r.score <= 0) continue;
      if (r.score < anchor) continue; // only places they'd actually vouch for
      positiveN++;
      const info = findMichelinMatchSync(r.name, undefined, undefined, r.address);
      if (!info) continue;
      if (info.stars > 0) starHits++;
      else if (info.bibGourmand) bibHits++;
      else if (info.selected) selectedHits++;
    }
    if (positiveN > 0) {
      michelinTaste = {
        starShare: starHits / positiveN,
        bibShare: bibHits / positiveN,
        selectedShare: selectedHits / positiveN,
      };
    }
  }

  return {
    cuisineScore,
    priceScore,
    priceCounts: priceScore,
    pairScore,
    tagScore,
    cityScore,
    topCuisines,
    topPrices,
    topPairs,
    topTags,
    topCities,
    topCity: topCities[0] ?? null,
    highRatedCount,
    ratedIds,
    wishlistedIds,
    recentlyViewedIds,
    avgScore,
    myScoreById,
    priceDist,
    distinctiveTaste,
    anchor,
    scoreP90,
    ratedNames,
    michelinTaste,
  };
}

export interface RecQuery {
  text: string;
  /** Google price-level tiers (1–4) to restrict the search to server-side.
   *  Omitted = unrestricted. NOTE: a price filter also excludes places whose
   *  price Google doesn't know, so the builder always leaves some queries
   *  unrestricted to keep unpriced hidden gems in the pool. */
  priceLevels?: number[];
}

/** Price tiers the user demonstrably favors: every tier holding ≥ 15% of the
 *  positive price mass. Falls back to the rounded distribution center. */
export function preferredPriceTiers(profile: TasteProfile): number[] {
  const dist = profile.priceDist;
  if (!dist) return [];
  const tiers = [1, 2, 3, 4].filter((t) => dist.share[t - 1] >= 0.15);
  if (tiers.length > 0) return tiers;
  return [Math.max(1, Math.min(4, Math.round(dist.center)))];
}

export function buildCandidateQueries(
  profile: TasteProfile,
  target: RecTargetLocation,
): RecQuery[] {
  const { topCuisines, topPrices, topPairs, priceDist } = profile;
  const label = target.label.trim();
  const isCurrent = !label || label === 'Current Location';
  const city = isCurrent
    ? ''
    : label
        .split(',')
        .slice(0, 2)
        .map((s) => s.trim())
        .filter(Boolean)
        .join(', ');

  // Server-side price restriction kicks in once the user's spending is
  // demonstrably concentrated — that's what actually keeps a premium
  // palate's pool from filling with cheap crowd-pleasers ("best $$$$
  // French" text alone barely biases Google).
  const restrict = (priceDist?.concentration ?? 0) >= 0.35;
  const allowedTiers = preferredPriceTiers(profile);
  const share = priceDist?.share ?? [0, 0, 0, 0];
  const lowShare = share[0] + share[1];
  const premiumShare = share[2] + share[3];

  const PRICE_SYMBOLS = ['', '$', '$$', '$$$', '$$$$'];
  const seen = new Set<string>();
  const out: RecQuery[] = [];
  const push = (raw: string, priceLevels?: number[]) => {
    const q = raw.trim().replace(/\s+/g, ' ');
    if (!q) return;
    const key = q.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(priceLevels && priceLevels.length > 0 ? { text: q, priceLevels } : { text: q });
  };

  // Tier 1: pairs — restricted to the pair's own tier when restricting.
  for (const pair of topPairs) {
    const sym = PRICE_SYMBOLS[pair.price] ?? '';
    push(
      `best ${sym} ${pair.cuisine} restaurants${city ? ' in ' + city : ''}`,
      restrict && pair.price >= 1 ? [pair.price] : undefined,
    );
  }

  // Tier 2: cuisine × price cross (only for cuisines not in a top pair)
  const pairedCuisines = new Set(topPairs.map((p) => p.cuisine));
  for (const cuisine of topCuisines) {
    if (pairedCuisines.has(cuisine)) continue;
    for (const price of topPrices) {
      const sym = PRICE_SYMBOLS[price] ?? '';
      push(
        `best ${sym} ${cuisine} restaurants${city ? ' in ' + city : ''}`,
        restrict && price >= 1 ? [price] : undefined,
      );
    }
  }

  // Tier 3: price anchors. "cheap X" only when the LOW tiers genuinely hold
  // real mass (≥ 35%) — a premium rater's couple of good $$ spots used to be
  // enough to inject cheap queries into their pool.
  if (priceDist) {
    if (premiumShare >= 0.5) {
      push(`fine dining${city ? ' ' + city : ' restaurants'}`);
      push(`tasting menu${city ? ' ' + city : ' restaurants'}`);
      push(`michelin star restaurants${city ? ' in ' + city : ''}`);
      for (const cuisine of topCuisines.slice(0, 3)) {
        push(`${cuisine} fine dining${city ? ' ' + city : ''}`);
      }
    } else if (Math.max(...(topPrices.length ? topPrices : [0])) >= 3) {
      push(`fine dining${city ? ' ' + city : ' restaurants'}`);
      for (const cuisine of topCuisines.slice(0, 3)) {
        push(`${cuisine} fine dining${city ? ' ' + city : ''}`);
      }
    }
    if (lowShare >= 0.35) {
      for (const cuisine of topCuisines.slice(0, 3)) {
        push(`cheap ${cuisine}${city ? ' ' + city : ' restaurants'}`);
      }
    }
  }

  // Tier 4: variety — restricted to the user's favored band when restricting.
  for (const cuisine of topCuisines) {
    push(
      `best ${cuisine} restaurants${city ? ' in ' + city : ''}`,
      restrict ? allowedTiers : undefined,
    );
  }

  // Tier 5: tail — always UNRESTRICTED. A price filter would drop every
  // place Google can't price, and hidden gems are disproportionately
  // unpriced; these queries keep them flowing into the pool.
  for (const cuisine of topCuisines) {
    push(`top rated ${cuisine} restaurants${city ? ' in ' + city : ''}`);
    push(`hidden gem ${cuisine} restaurants${city ? ' ' + city : ''}`);
  }
  if (city) {
    push(`trending restaurants ${city}`);
    push(`popular restaurants ${city}`);
  }

  return out;
}

export function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface CandidateSignals {
  expertUserIds: Set<string>;
  followedExpertIds: Set<string>;
  friendUserIds: Set<string>;
  communityByRestaurant: Map<string, CommunityRating[]>;
  expertRecRestaurantIds: Set<string>;
}

export interface ScoreCandidatesOptions {
  /** Max number of places to return. Defaults to 12. Pass e.g. Infinity to
   *  rank an entire pool (used by /location, which wants every restaurant
   *  in the city sorted but not truncated). */
  limit?: number;
  /** When true (default), restaurants the user has already rated, wishlisted,
   *  or recently viewed are dropped from the output. Surfaces that want to
   *  show every matching restaurant regardless of history (again, /location)
   *  pass `false`. */
  skipUserHistory?: boolean;
  /** With skipUserHistory on, keep wishlisted + recently-viewed places and
   *  drop only the ones the user has actually rated. The recs browser uses
   *  this: a wishlisted spot is a good recommendation — it gets an
   *  "On your wishlist" chip and a small boost instead of being hidden. */
  keepWishlisted?: boolean;
  /** Hard price-band enforcement for RECOMMENDATION surfaces: with enough
   *  priced history (n ≥ 8), tiers holding <5% of the user's positive price
   *  mass AND sitting more than one tier from their spending center are
   *  dropped entirely — a $$$/$$$$-only rater simply doesn't get $/$$ recs,
   *  and vice versa (wishlisted places are exempt: explicit intent wins).
   *  OFF by default so browse-everything surfaces (/location) keep listing
   *  the whole city. */
  enforcePriceBand?: boolean;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

const formatReviewCount = (n: number): string =>
  n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n);

/**
 * Taste similarity per friend, from ratings you both logged: 1 point of
 * agreement when your scores match, fading to 0 at a 4-point gap, blended
 * with a neutral prior until enough co-ratings exist to trust it. Output is
 * 0.35 (consistent disagree-er) … 1.0 (rated the same places, same way);
 * friends with zero overlap fall back to 0.6 at the call site.
 */
function buildFriendSimilarity(
  profile: TasteProfile,
  signals: CandidateSignals,
): Map<string, number> {
  const sims = new Map<string, number>();
  const mine = profile.myScoreById;
  if (!mine || mine.size === 0) return sims;
  const stats = new Map<string, { n: number; agree: number }>();
  for (const rows of signals.communityByRestaurant.values()) {
    for (const row of rows) {
      if (!signals.friendUserIds.has(row.user_id)) continue;
      const my = mine.get(row.restaurant_id);
      if (my === undefined) continue;
      const s = stats.get(row.user_id) || { n: 0, agree: 0 };
      s.n++;
      s.agree += 1 - Math.min(1, Math.abs(my - row.score) / 4);
      stats.set(row.user_id, s);
    }
  }
  for (const [fid, s] of stats) {
    const conf = s.n / (s.n + 2);          // 1 co-rating → ⅓ trust, 4 → ⅔
    const blend = conf * (s.agree / s.n) + (1 - conf) * 0.5;
    sims.set(fid, 0.35 + 0.65 * blend);
  }
  return sims;
}

/**
 * Greedy MMR-style re-rank of the top of the list: each pick charges a fading
 * penalty to later same-cuisine picks, so a strong #1 still wins but the top
 * of the page doesn't become five pizzerias. Places past `depth` keep their
 * plain score order (the tail is browse territory, not the pitch).
 */
function diversifyByCuisine(
  sorted: ScoredPlace[],
  inferCuisine: (types: string[]) => string,
  depth = 30,
  penalty = 0.7,
): ScoredPlace[] {
  if (sorted.length <= 2) return sorted;
  const pool = sorted.slice(0, depth);
  const rest = sorted.slice(depth);
  const out: ScoredPlace[] = [];
  const counts: Record<string, number> = {};
  while (pool.length > 0) {
    let bestI = 0;
    let bestV = -Infinity;
    for (let i = 0; i < pool.length; i++) {
      const cu = inferCuisine(pool[i].types);
      const v = pool[i].recScore - (cu ? penalty * (counts[cu] || 0) : 0);
      if (v > bestV) { bestV = v; bestI = i; }
    }
    const [pick] = pool.splice(bestI, 1);
    const cu = inferCuisine(pick.types);
    if (cu) counts[cu] = (counts[cu] || 0) + 1;
    out.push(pick);
  }
  return [...out, ...rest];
}

/** Michelin distinction → distinctiveness weight / quality substitute. */
const MICHELIN_DIST_WEIGHT = (m: NonNullable<RecCandidate['michelin']>): number =>
  m.stars === 3 ? 1.0 : m.stars === 2 ? 0.9 : m.stars === 1 ? 0.8 : m.selected ? 0.55 : m.bibGourmand ? 0.45 : 0;
const MICHELIN_QUALITY_SUB = (m: NonNullable<RecCandidate['michelin']>): number =>
  m.stars === 3 ? 0.85 : m.stars === 2 ? 0.75 : m.stars === 1 ? 0.65 : m.bibGourmand ? 0.45 : m.selected ? 0.35 : 0;
const michelinChip = (m: NonNullable<RecCandidate['michelin']>): string =>
  m.stars > 0 ? `Michelin ${m.stars}-star` : m.bibGourmand ? 'Michelin Bib Gourmand' : 'In the Michelin Guide';

export function scoreCandidates(
  candidates: RecCandidate[],
  profile: TasteProfile,
  signals: CandidateSignals,
  target: RecTargetLocation,
  radiusMeters: number,
  options: ScoreCandidatesOptions = {},
): ScoredPlace[] {
  const W = DEFAULT_WEIGHTS;
  const limit = options.limit ?? 12;
  const skipUserHistory = options.skipUserHistory ?? true;
  const keepWishlisted = options.keepWishlisted ?? false;
  const enforcePriceBand = options.enforcePriceBand ?? false;

  const googleTypeToLabel: Record<string, string> = {};
  for (const entry of CUISINE_TYPES) {
    if (entry.type) googleTypeToLabel[entry.type] = entry.label;
  }
  const inferCuisine = (types: string[]): string => {
    for (const t of types) {
      if (googleTypeToLabel[t]) return googleTypeToLabel[t];
    }
    return '';
  };

  const radiusKm = radiusMeters / 1000;
  const skipIds = new Set<string>();
  if (skipUserHistory) {
    profile.ratedIds.forEach((id) => skipIds.add(id));
    if (!keepWishlisted) {
      profile.wishlistedIds.forEach((id) => skipIds.add(id));
      profile.recentlyViewedIds.forEach((id) => skipIds.add(id));
    }
  }

  // Palate stats driving the v3 terms. Price weight and its mismatch slope
  // both grow with concentration — a user whose spend clusters in one band
  // has earned a hard opinion; a scattered profile keeps the mild v2 weight.
  const dist = profile.priceDist;
  const conc = dist?.concentration ?? 0;
  const distinct = profile.distinctiveTaste ?? 0;
  const wPrice = W.price + 1.1 * conc;
  const priceSlope = 0.6 + 0.6 * conc;
  const shareMax = dist ? Math.max(...dist.share, 0.0001) : 1;
  const wPopularity = W.popularity * (1 - 0.7 * distinct);

  // ── Normalizers ──
  // Raw profile sums are unbounded (a 200-rating power user's cuisine sums
  // run 50× a new user's), so every affinity is squashed to [-1, 1] against
  // the profile's own strongest signal before its weight applies. That keeps
  // the factor weights meaningful across account sizes: taste never drowns
  // out quality/friends for heavy raters, and never vanishes for light ones.
  const maxAbs = (m: Record<string, number> | Record<number, number>): number => {
    let x = 0;
    for (const v of Object.values(m)) x = Math.max(x, Math.abs(v));
    return x;
  };
  const cuisineMax = maxAbs(profile.cuisineScore) || 1;
  const priceMax = maxAbs(profile.priceScore) || 1;
  const pairMax = maxAbs(profile.pairScore) || 1;
  const tagMax = maxAbs(profile.tagScore) || 1;
  const aff = (raw: number | undefined, max: number): number =>
    raw === undefined ? 0 : clamp(raw / max, -1, 1);

  // Taste terms ramp in as the user rates (0 ratings → pure quality/social,
  // 3+ high ratings → full personalization) instead of the old binary
  // cold-start cliff at exactly 3.
  const ramp = clamp(profile.highRatedCount / 3, 0, 1);

  const friendSim = buildFriendSimilarity(profile, signals);

  const scored: ScoredPlace[] = [];

  for (const c of candidates) {
    if (skipIds.has(c.id)) continue;
    // A Michelin synthetic candidate can duplicate an already-rated place
    // under a different id — suppress by normalized name.
    if (isMichelinSyntheticId(c.id) && profile.ratedNames?.has(normalizeName(c.name))) continue;
    // Hard price band (rec surfaces only): with real history behind the
    // distribution, tiers the user demonstrably never spends in aren't
    // demoted — they're not recommended at all.
    if (
      enforcePriceBand &&
      dist &&
      dist.n >= 8 &&
      c.priceLevel >= 1 &&
      c.priceLevel <= 4 &&
      dist.share[c.priceLevel - 1] < 0.05 &&
      Math.abs(c.priceLevel - dist.center) > 1 &&
      !profile.wishlistedIds.has(c.id)
    ) continue;

    const cuisine = inferCuisine(c.types);
    const price = c.priceLevel;
    const distKm = haversineKm(
      { lat: c.lat, lng: c.lng },
      { lat: target.lat, lng: target.lng },
    );
    const communityRows = signals.communityByRestaurant.get(c.id) || [];

    // Personal-fit terms and generic-quality terms accumulate separately so
    // the predicted score can weigh taste evidence far above generic acclaim
    // (the old match % conflated them — a popular 4.6★ with zero taste fit
    // read as "80% match").
    let personalFit = 0;
    let genericQuality = 0;
    const sources: ScoredPlace['sources'] = ['google'];
    const reasons: Array<{ w: number; label: string }> = [];

    // ── Taste match ──
    if (ramp > 0) {
      const cA = aff(cuisine ? profile.cuisineScore[cuisine] : undefined, cuisineMax);
      const cTerm = W.cuisine * (cA < 0 ? cA * W.negativeMult : cA) * ramp;
      personalFit += cTerm;
      if (cA >= 0.35 && cuisine) reasons.push({ w: cTerm, label: `Top cuisine: ${cuisine}` });

      // Price fit from the user's actual spend distribution: reward tiers
      // holding real mass, charge a concentration-scaled slope for straying
      // from the center — and give unknown prices a mild prior penalty
      // instead of the old free pass (backfill upstream fills most of them).
      let pA: number;
      if (dist && price >= 1 && price <= 4) {
        pA = clamp(
          dist.share[price - 1] / shareMax - priceSlope * Math.max(0, Math.abs(price - dist.center) - 0.5),
          -1,
          1,
        );
      } else if (dist) {
        pA = -0.35 * conc;
      } else {
        pA = 0;
      }
      const pTerm = wPrice * pA * ramp;
      personalFit += pTerm;
      if (pA >= 0.35 && price > 0) reasons.push({ w: pTerm, label: `In your price range (${'$'.repeat(price)})` });

      const prA = aff(cuisine && price > 0 ? profile.pairScore[`${cuisine}|${price}`] : undefined, pairMax);
      const prTerm = W.pair * (prA < 0 ? prA * W.negativeMult : prA) * ramp;
      personalFit += prTerm;
      if (prA >= 0.5 && cuisine && price > 0) {
        reasons.push({ w: prTerm, label: `Your sweet spot: ${'$'.repeat(price)} ${cuisine}` });
      }

      // Tag overlap — community tags on this place vs tags the user hands out.
      const tagSet = new Set<string>();
      for (const row of communityRows) {
        for (const t of row.tags || []) tagSet.add(t);
      }
      let tagSum = 0;
      const matchedTags: Array<{ t: string; a: number }> = [];
      for (const t of tagSet) {
        const a = aff(profile.tagScore[t], tagMax);
        if (a > 0) { tagSum += a * 0.5; matchedTags.push({ t, a }); }
      }
      const tTerm = W.tagOverlap * Math.min(1, tagSum) * ramp;
      if (tTerm > 0) {
        personalFit += tTerm;
        sources.push('tagSimilar');
        matchedTags.sort((x, y) => y.a - x.a);
        if (tTerm >= 0.3) {
          reasons.push({ w: tTerm, label: `Your vibe: ${matchedTags.slice(0, 2).map((m) => m.t).join(', ')}` });
        }
      }
    }

    // ── Distinctiveness (Michelin / boutique) ──
    // Scaled by the user's own palate: a crowd-follower gets ~nothing from a
    // star; the premium-and-curious profile gets a real lift. Not ramped —
    // distinctiveTaste already grows with data volume.
    const candDistinct = c.michelin
      ? MICHELIN_DIST_WEIGHT(c.michelin)
      : c.rating >= 4.5 && c.userRatingCount >= 25 && c.userRatingCount <= 800 && price >= 3
        ? 0.5
        : 0;
    if (candDistinct > 0 && distinct > 0) {
      const dTerm = W.distinctive * distinct * candDistinct;
      personalFit += dTerm;
      if (c.michelin) {
        sources.push('michelin');
        reasons.push({ w: dTerm + 1, label: michelinChip(c.michelin) });
      } else if (dTerm >= 0.4) {
        reasons.push({ w: dTerm, label: 'Under-the-radar find' });
      }
    } else if (c.michelin) {
      // Still badge the star for context even when the palate doesn't earn
      // a boost from it.
      sources.push('michelin');
      reasons.push({ w: 0.2, label: michelinChip(c.michelin) });
    }

    // ── Michelin taste match ──
    // Beyond generic distinctiveness: a user whose loved places are FULL of
    // starred rooms gets starred candidates lifted specifically (and a Bib
    // hunter gets Bibs). Share saturates at ⅓ of their history.
    if (c.michelin && profile.michelinTaste) {
      const mt = profile.michelinTaste;
      const share = c.michelin.stars > 0
        ? mt.starShare
        : c.michelin.bibGourmand
          ? mt.bibShare
          : mt.selectedShare;
      if (share > 0) {
        const mTerm = W.michelinTaste * Math.min(1, share * 3) * MICHELIN_DIST_WEIGHT(c.michelin);
        personalFit += mTerm;
      }
    }

    // ── Quality prior (Bayesian) ──
    // Shrink the star rating toward the 3.8 baseline by review count, so a
    // 4.6 backed by a thousand reviews beats a 5.0 backed by three.
    // Michelin-only candidates carry no Google rating — the distinction
    // itself substitutes (a starred kitchen isn't a coin flip on quality).
    let bayesForPredict = 3.8;
    if (c.rating > 0) {
      const v = c.userRatingCount || 0;
      const bayes = (v * c.rating + 25 * 3.8) / (v + 25);
      bayesForPredict = bayes;
      const q = clamp(bayes - 3.8, -1, 1);
      const qTerm = W.quality * q;
      genericQuality += qTerm;
      if (q >= 0.55 && v >= 150) {
        reasons.push({ w: qTerm, label: `${c.rating.toFixed(1)}★ from ${formatReviewCount(v)} reviews` });
      }
    } else if (c.michelin) {
      const qSub = MICHELIN_QUALITY_SUB(c.michelin);
      genericQuality += W.quality * qSub;
      bayesForPredict = 3.8 + qSub;
    }
    genericQuality += wPopularity * Math.min(1, Math.log1p(c.userRatingCount || 0) / Math.log1p(3000));

    // ── In-app popularity ──
    // Distinct users of THIS app who rated the place. Saturates fast (~20
    // raters) because the platform is young; today this contributes ~0 and
    // it strengthens automatically as the community rates more.
    const appN = c.appRatingCount ?? 0;
    if (appN > 0) {
      const aTerm = W.appPopularity * Math.min(1, Math.log1p(appN) / Math.log1p(20));
      genericQuality += aTerm;
      if (appN >= 3) {
        reasons.push({ w: aTerm, label: `Rated by ${appN} in the community` });
      }
    }

    // ── Expert signal (bounded) ──
    let expertRaw = 0;
    let followedExpert = false;
    for (const row of communityRows) {
      if (row.score >= 8 && signals.expertUserIds.has(row.user_id)) {
        const followed = signals.followedExpertIds.has(row.user_id);
        if (followed) followedExpert = true;
        expertRaw += followed ? 0.75 : 0.5;
      }
    }
    const hasExpertRec = signals.expertRecRestaurantIds.has(c.id);
    if (hasExpertRec) expertRaw += 1;
    if (expertRaw > 3) expertRaw = 3;
    if (expertRaw > 0) {
      const eTerm = W.expert * (expertRaw / 3);
      personalFit += eTerm;
      sources.push('expert');
      if (hasExpertRec) sources.push('expertRec');
      reasons.push({ w: eTerm, label: followedExpert ? 'Pick from experts you follow' : 'Expert pick' });
    }

    // ── Friend signal: enthusiasm × taste similarity, negatives included ──
    // A like-minded friend's 9 moves the needle hard; a friend whose taste
    // has never matched yours barely registers; a friend's 3 pushes DOWN.
    let friendRaw = 0;
    let friendsLoved = 0;
    for (const row of communityRows) {
      if (!signals.friendUserIds.has(row.user_id)) continue;
      const sim = friendSim.get(row.user_id) ?? 0.6;
      const enthusiasm = clamp((row.score - 6.5) / 3.5, -1, 1);
      friendRaw += enthusiasm * sim;
      if (row.score >= 8) friendsLoved++;
    }
    if (friendRaw !== 0) {
      const fTerm = W.friend * (clamp(friendRaw, -1.5, 2) / 2);
      personalFit += fTerm;
      if (fTerm > 0) {
        sources.push('friend');
        if (friendsLoved > 0) {
          reasons.push({
            w: fTerm,
            label: friendsLoved > 1 ? `Loved by ${friendsLoved} friends` : 'Loved by a friend',
          });
        }
      }
    }

    // ── Wishlist (only when kept in the pool) ──
    if (keepWishlisted && profile.wishlistedIds.has(c.id)) {
      personalFit += W.wishlist;
      reasons.push({ w: W.wishlist, label: 'On your wishlist' });
    }

    // ── Distance decay (soft, past half the radius; capped) ──
    // Ranks by it, but the predicted score deliberately ignores it — how much
    // you'd LIKE a place doesn't depend on how far you are from it today.
    const extra = Math.max(0, distKm - radiusKm * 0.5);
    const distancePenalty = W.distance * Math.min(1.5, extra / Math.max(radiusKm, 0.5));
    const score = personalFit + genericQuality - distancePenalty;

    // ── Predicted score (Beli-style, the user's own 0–10 scale) ──
    // Anchored to their shrunk personal mean (−0.35 self-selection correction:
    // people rate places they chose to visit, so the mean overstates a random
    // rec), spread by taste evidence, nudged by generic quality, capped by
    // their own realistic ceiling. Cold accounts fall back to Bayesian stars.
    const anchor = profile.anchor ?? 7;
    const fitN = Math.tanh(personalFit / 3.2);
    const qualN = Math.tanh(genericQuality / 2.5);
    const personalPredicted = anchor - 0.35 + 1.8 * fitN + 0.45 * qualN;
    const coldPredicted = clamp(2 * bayesForPredict - 1.6, 5.0, 9.0);
    const nPos = profile.myScoreById.size;
    const rampP = nPos / (nPos + 5);
    const cap = Math.min(9.8, (profile.scoreP90 ?? 9.4) + 0.4);
    const own = profile.myScoreById.get(c.id);
    const predicted = own !== undefined
      ? own
      : Math.round(clamp(rampP * personalPredicted + (1 - rampP) * coldPredicted, 5.0, cap) * 10) / 10;

    reasons.sort((a, b) => b.w - a.w);
    scored.push({
      ...c,
      recScore: score,
      sources,
      reasons: reasons.slice(0, 3).map((r) => r.label),
      predicted,
    });
  }

  scored.sort((a, b) => b.recScore - a.recScore);
  return diversifyByCuisine(scored, inferCuisine).slice(0, limit);
}

/** A gathered, score-ready candidate pool. Scoring is separate so the UI can
 *  re-rank the same pool synchronously whenever the user's ratings change. */
export interface RecPool {
  candidates: RecCandidate[];
  signals: CandidateSignals;
  fetchedAt: number;
}

/** First `max` queries, but always with ≥2 unrestricted ones mixed in — a
 *  price filter excludes every place Google can't price, and hidden gems are
 *  disproportionately unpriced. Exported for tests. */
export function sliceQueriesBalanced(queries: RecQuery[], max: number): RecQuery[] {
  const head = queries.slice(0, max);
  if (queries.length <= max) return head;
  const unrestricted = head.filter((q) => !q.priceLevels).length;
  if (unrestricted >= 2) return head;
  const extras = queries.slice(max).filter((q) => !q.priceLevels).slice(0, 2 - unrestricted);
  if (extras.length === 0) return head;
  return [...head.slice(0, max - extras.length), ...extras];
}

const toMichelinBadge = (info: MichelinInfo): NonNullable<RecCandidate['michelin']> => ({
  stars: info.stars,
  bibGourmand: info.bibGourmand,
  selected: info.selected,
});

/**
 * Gather a score-ready candidate pool for a location: price-aware Google text
 * queries + cached pool + community rows + nearby Michelin entries, with
 * unknown prices backfilled (Michelin tier, then community mode) so nothing
 * dodges the price term. Runs NO scoring — callers pass the pool through
 * scoreCandidates, and can re-score it for free when the profile changes.
 */
export async function gatherRecCandidates(
  opts: Omit<RecOptions, 'limit' | 'keepWishlisted'>,
): Promise<RecPool> {
  const maxQueries = opts.maxQueries ?? 5;
  const allowedTiers = preferredPriceTiers(opts.profile);
  // The v3 marker + tier fingerprint invalidates every pre-v3 cached pool —
  // pools assembled without price-restricted queries skew cheap and would
  // otherwise keep satisfying cache hits for two more days.
  const prefsHash =
    preferencesHash(opts.profile.topCuisines, opts.profile.topPrices) +
    '|r=' +
    opts.radiusMeters +
    '|v3:' +
    allowedTiers.join('');
  const locKey = locationKey(opts.target.lat, opts.target.lng);

  let mergeCached: PlaceResult[] = [];
  let skipGoogle = false;
  if (opts.userId) {
    const cached = await getHomeRecsCache(opts.userId, locKey);
    if (cached && Date.now() - cached.updatedAt < 2 * 24 * 60 * 60 * 1000) {
      mergeCached = cached.places;
      // A fresh same-prefs pool that's deep enough to rank is a full hit;
      // a thin or drifted one still merges in but gets fresh queries too.
      if (cached.preferencesHash === prefsHash && cached.places.length >= 25) {
        skipGoogle = true;
      }
    }
  }

  if (opts.signal?.aborted) return { candidates: [], signals: emptySignals(), fetchedAt: Date.now() };

  const queries = skipGoogle
    ? []
    : sliceQueriesBalanced(buildCandidateQueries(opts.profile, opts.target), maxQueries);

  const [
    googleBatches,
    tagSimilar,
    expertRatings,
    friendRatings,
    experts,
    followedExperts,
  ] = await Promise.all([
    Promise.all(
      queries.map((q) =>
        q.priceLevels && q.priceLevels.length > 0
          ? // Price-restricted: the paged search sends `priceLevels` so Google
            // filters server-side (one request; no food-type filter, so apply
            // ours locally).
            searchPlacesByTextPaged(q.text, {
              lat: opts.target.lat,
              lng: opts.target.lng,
              radiusMeters: opts.radiusMeters,
              useRestriction: true,
              priceLevels: q.priceLevels,
            })
              .then((page) => page.places.filter((p) => isFoodPlace(p.types)))
              .catch(() => [] as PlaceResult[])
          : searchPlacesByText(
              q.text,
              opts.target.lat,
              opts.target.lng,
              opts.target.label || undefined,
              /* useRestriction */ true,
              opts.radiusMeters,
            ).catch(() => [] as PlaceResult[]),
      ),
    ),
    getTagSimilarRestaurants(
      opts.profile.topTags,
      opts.target.label,
      opts.userId ?? '',
      40,
    ).catch(() => [] as CommunityRating[]),
    getExpertRatings(100).catch(() => [] as CommunityRating[]),
    opts.userId
      ? getAllFriendRatings(opts.userId).catch(() => [] as CommunityRating[])
      : Promise.resolve([] as CommunityRating[]),
    getExpertProfiles().catch(() => []),
    opts.userId
      ? getFollowedExpertIds(opts.userId).catch(() => new Set<string>())
      : Promise.resolve(new Set<string>()),
    // Michelin dataset rides along in the same wait — needed below for the
    // nearby merge and the price/star attach. Free (local JSON chunk).
    ensureMichelinIndex().catch(() => undefined),
  ]);

  if (opts.signal?.aborted) return { candidates: [], signals: emptySignals(), fetchedAt: Date.now() };

  const expertUserIds = new Set<string>(experts.map((e) => e.user_id));
  const friendUserIds = new Set<string>(friendRatings.map((r) => r.user_id));

  const allCommunityRows: CommunityRating[] = [
    ...tagSimilar,
    ...expertRatings,
    ...friendRatings,
  ];
  const communityByRestaurant = new Map<string, CommunityRating[]>();
  for (const row of allCommunityRows) {
    const arr = communityByRestaurant.get(row.restaurant_id);
    if (arr) arr.push(row);
    else communityByRestaurant.set(row.restaurant_id, [row]);
  }

  // Candidate pool: Google results win on id conflicts (richer metadata),
  // then cached places, then pseudo-places from community rows.
  const byId = new Map<string, RecCandidate>();
  for (const batch of googleBatches) {
    for (const p of batch) {
      if (!byId.has(p.id)) byId.set(p.id, p);
    }
  }
  for (const p of mergeCached) {
    if (!byId.has(p.id)) byId.set(p.id, p);
  }
  // Community pseudo-places carry their rating's cuisine as a Google type so
  // the scorer's cuisine/pair affinities apply to them too (they used to land
  // with types: [] and score purely on the social term).
  const labelToType: Record<string, string> = {};
  for (const entry of CUISINE_TYPES) {
    if (entry.type) labelToType[entry.label.toLowerCase()] = entry.type;
  }
  for (const row of allCommunityRows) {
    if (byId.has(row.restaurant_id)) continue;
    const cuisineType = row.cuisine ? labelToType[row.cuisine.toLowerCase()] : undefined;
    byId.set(row.restaurant_id, {
      id: row.restaurant_id,
      name: row.restaurant_name,
      lat: row.lat ?? 0,
      lng: row.lng ?? 0,
      rating: 0,
      priceLevel: row.price?.length ?? 0,
      address: row.address,
      fullAddress: row.address,
      photoUrl: null,
      types: cuisineType ? [cuisineType] : [],
      userRatingCount: 0,
    });
  }

  // ── Michelin attach + nearby merge ──
  // 1) Stamp star/price info onto Google candidates that match the Guide.
  // 2) Add nearby Guide entries the queries missed as candidates of their
  //    own (synthetic ids resolve to real places on the detail page).
  for (const c of byId.values()) {
    if (c.michelin || isMichelinSyntheticId(c.id)) continue;
    const info = findMichelinMatchSync(c.name, c.lat, c.lng, c.fullAddress || c.address);
    if (!info) continue;
    c.michelin = toMichelinBadge(info);
    if (c.priceLevel < 1 && info.priceTier >= 1) c.priceLevel = info.priceTier;
  }
  const radiusMi = opts.radiusMeters / 1609.34;
  const existing = Array.from(byId.values());
  let added = 0;
  for (const m of michelinNearbySync(opts.target.lat, opts.target.lng, Math.min(radiusMi, 31))) {
    if (added >= 30) break;
    const mName = m.name.toLowerCase();
    const dup = existing.some(
      (p) => p.name.toLowerCase() === mName && haversineDistanceMi(p.lat, p.lng, m.lat, m.lng) < 0.12,
    );
    if (dup) continue;
    const place = michelinToPlaceResult(m) as RecCandidate;
    if (byId.has(place.id)) continue;
    place.michelin = toMichelinBadge(m);
    byId.set(place.id, place);
    added++;
  }

  // Post-filter by radius with 25% slack; the distance penalty handles the rest.
  const radiusKm = opts.radiusMeters / 1000;
  const slackKm = radiusKm * 1.25;
  const candidates: RecCandidate[] = [];
  for (const c of byId.values()) {
    const dist = haversineKm(
      { lat: c.lat, lng: c.lng },
      { lat: opts.target.lat, lng: opts.target.lng },
    );
    if (dist <= slackKm) candidates.push(c);
  }

  // ── Community backfill: prices + in-app popularity ──
  // Two batched queries: unknown tiers fill from the community's price
  // consensus (so the scorer's unknown-price prior only hits places nobody
  // has priced anywhere), and every candidate gets its distinct-rater count
  // for the platform-popularity term. Counts refresh on cache hits too —
  // cached pools may carry stale numbers.
  const nonSyntheticIds = candidates.filter((c) => !isMichelinSyntheticId(c.id)).map((c) => c.id);
  const unpricedIds = candidates
    .filter((c) => c.priceLevel < 1 && !isMichelinSyntheticId(c.id))
    .map((c) => c.id);
  try {
    const [communityPrices, ratingCounts] = await Promise.all([
      unpricedIds.length > 0 ? getCommunityPricesForPlaces(unpricedIds) : Promise.resolve({} as Record<string, string>),
      nonSyntheticIds.length > 0 ? getCommunityRatingCounts(nonSyntheticIds) : Promise.resolve({} as Record<string, number>),
    ]);
    for (const c of candidates) {
      if (c.priceLevel < 1) {
        const tier = (communityPrices[c.id] || '').length;
        if (tier >= 1 && tier <= 4) c.priceLevel = tier;
      }
      c.appRatingCount = ratingCounts[c.id] ?? 0;
    }
  } catch { /* display-quality data only — never block the pool */ }

  // Only fetch if we actually have candidates to look up. One batched query.
  const candidateIds = candidates.map((c) => c.id);
  const expertRecIds = new Set<string>();
  if (candidateIds.length > 0 && opts.userId) {
    try {
      const { supabase, supabaseConfigured } = await import('./supabase');
      if (supabaseConfigured) {
        const { data } = await supabase
          .from('expert_recommendations')
          .select('restaurant_id')
          .in('restaurant_id', candidateIds);
        for (const row of data || []) expertRecIds.add((row as { restaurant_id: string }).restaurant_id);
      }
    } catch { /* ignore */ }
  }

  const signals: CandidateSignals = {
    expertUserIds,
    followedExpertIds: followedExperts,
    friendUserIds,
    communityByRestaurant,
    expertRecRestaurantIds: expertRecIds,
  };

  // Persist the pool (not a scored page of it) whenever we actually hit
  // Google, so the next open of the same city ranks instantly with zero
  // Places spend. Michelin synthetics are excluded — they rebuild for free
  // from the local dataset. Ordered by a quality proxy so the cap keeps the
  // most useful 60.
  if (opts.userId && !skipGoogle && candidates.length > 0) {
    const persistable = candidates
      .filter((c) => !isMichelinSyntheticId(c.id))
      .sort((a, b) => {
        const bayes = (p: RecCandidate) =>
          p.rating > 0 ? (p.userRatingCount * p.rating + 25 * 3.8) / (p.userRatingCount + 25) : 3.8;
        return bayes(b) - bayes(a);
      })
      .slice(0, 60);
    if (persistable.length > 0) {
      void saveHomeRecsCache(
        opts.userId,
        locKey,
        opts.target.label,
        opts.target.lat,
        opts.target.lng,
        prefsHash,
        persistable,
      );
    }
  }

  return { candidates, signals, fetchedAt: Date.now() };
}

function emptySignals(): CandidateSignals {
  return {
    expertUserIds: new Set(),
    followedExpertIds: new Set(),
    friendUserIds: new Set(),
    communityByRestaurant: new Map(),
    expertRecRestaurantIds: new Set(),
  };
}

/**
 * Full pipeline: gather a pool, rank it. A cache hit skips the Google spend,
 * never the scoring — results always carry recScore / reasons / predicted,
 * and the social lifts stay current even when the pool comes from cache.
 */
export async function getRecommendations(opts: RecOptions): Promise<ScoredPlace[]> {
  const limit = opts.limit ?? 12;
  const pool = await gatherRecCandidates(opts);
  if (opts.signal?.aborted) return [];
  return scoreCandidates(
    pool.candidates,
    opts.profile,
    pool.signals,
    opts.target,
    opts.radiusMeters,
    {
      limit,
      skipUserHistory: true,
      keepWishlisted: opts.keepWishlisted,
      enforcePriceBand: opts.enforcePriceBand ?? true,
    },
  );
}
