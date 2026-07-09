import type { PlaceResult } from './places';
import { extractCityState, CUISINE_TYPES, searchPlacesByText } from './places';
import type { CommunityRating } from './supabase-community';
import {
  getExpertRatings,
  getAllFriendRatings,
  getExpertProfiles,
  getTagSimilarRestaurants,
  getFollowedExpertIds,
} from './supabase-community';
import { locationKey, preferencesHash, getHomeRecsCache, saveHomeRecsCache } from './supabase-rec-cache';
import type { RestaurantRating, WishlistItem, CustomList } from '../contexts/ListsContext';

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
}

export interface ScoredPlace extends PlaceResult {
  recScore: number;
  sources: Array<'google' | 'tagSimilar' | 'expert' | 'friend' | 'expertRec'>;
  /** Human-readable "why this" chips, strongest factor first (≤3). Absent on
   *  legacy call sites that fabricate ScoredPlace literals. */
  reasons?: string[];
  /** 0–100 calibrated match confidence (logistic squash of recScore). */
  match?: number;
}

/**
 * Every factor below is normalized to [-1, 1] before its weight is applied
 * (see scoreCandidates), so these are directly comparable: taste-pair match
 * and a like-minded friend's rave are the loudest signals, quality/cuisine
 * next, popularity is a mild tiebreaker.
 */
export const DEFAULT_WEIGHTS = {
  cuisine: 1.6,
  price: 0.9,
  pair: 1.8,
  tagOverlap: 1.1,
  popularity: 0.5,
  quality: 1.5,
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

  for (const r of ratings) {
    if (r.score <= 0) continue;
    myScoreById.set(r.restaurantId, r.score);
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
  };
}

export function buildCandidateQueries(
  profile: TasteProfile,
  target: RecTargetLocation,
): string[] {
  const { topCuisines, topPrices, topPairs } = profile;
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

  const PRICE_SYMBOLS = ['', '$', '$$', '$$$', '$$$$'];
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (raw: string) => {
    const q = raw.trim().replace(/\s+/g, ' ');
    if (!q) return;
    const key = q.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(q);
  };

  // Tier 1: pairs
  for (const pair of topPairs) {
    const sym = PRICE_SYMBOLS[pair.price] ?? '';
    push(`best ${sym} ${pair.cuisine} restaurants${city ? ' in ' + city : ''}`);
  }

  // Tier 2: cuisine × price cross (only for cuisines not in a top pair)
  const pairedCuisines = new Set(topPairs.map((p) => p.cuisine));
  for (const cuisine of topCuisines) {
    if (pairedCuisines.has(cuisine)) continue;
    for (const price of topPrices) {
      const sym = PRICE_SYMBOLS[price] ?? '';
      push(`best ${sym} ${cuisine} restaurants${city ? ' in ' + city : ''}`);
    }
  }

  // Tier 3: price anchors
  if (topPrices.length > 0) {
    const maxP = Math.max(...topPrices);
    const minP = Math.min(...topPrices);
    if (maxP >= 3) {
      push(`fine dining${city ? ' ' + city : ' restaurants'}`);
      for (const cuisine of topCuisines.slice(0, 3)) {
        push(`${cuisine} fine dining${city ? ' ' + city : ''}`);
      }
    }
    if (minP <= 2) {
      for (const cuisine of topCuisines.slice(0, 3)) {
        push(`cheap ${cuisine}${city ? ' ' + city : ' restaurants'}`);
      }
    }
  }

  // Tier 4: variety
  for (const cuisine of topCuisines) {
    push(`best ${cuisine} restaurants${city ? ' in ' + city : ''}`);
  }

  // Tier 5: tail
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

export function scoreCandidates(
  candidates: PlaceResult[],
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

    const cuisine = inferCuisine(c.types);
    const price = c.priceLevel;
    const distKm = haversineKm(
      { lat: c.lat, lng: c.lng },
      { lat: target.lat, lng: target.lng },
    );
    const communityRows = signals.communityByRestaurant.get(c.id) || [];

    let score = 0;
    const sources: ScoredPlace['sources'] = ['google'];
    const reasons: Array<{ w: number; label: string }> = [];

    // ── Taste match ──
    if (ramp > 0) {
      const cA = aff(cuisine ? profile.cuisineScore[cuisine] : undefined, cuisineMax);
      const cTerm = W.cuisine * (cA < 0 ? cA * W.negativeMult : cA) * ramp;
      score += cTerm;
      if (cA >= 0.35 && cuisine) reasons.push({ w: cTerm, label: `Top cuisine: ${cuisine}` });

      let pA = aff(price > 0 ? profile.priceScore[price] : undefined, priceMax);
      // Price-distance: two tiers away from everything the user actually
      // favors is a miss even if that tier's raw sum is mildly positive.
      if (price > 0 && profile.topPrices.length > 0) {
        const gap = Math.min(...profile.topPrices.map((p) => Math.abs(p - price)));
        if (gap >= 2) pA -= 0.5 * (gap - 1);
      }
      const pTerm = W.price * clamp(pA, -1, 1) * ramp;
      score += pTerm;
      if (pA >= 0.35 && price > 0) reasons.push({ w: pTerm, label: `In your price range (${'$'.repeat(price)})` });

      const prA = aff(cuisine && price > 0 ? profile.pairScore[`${cuisine}|${price}`] : undefined, pairMax);
      const prTerm = W.pair * (prA < 0 ? prA * W.negativeMult : prA) * ramp;
      score += prTerm;
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
        score += tTerm;
        sources.push('tagSimilar');
        matchedTags.sort((x, y) => y.a - x.a);
        if (tTerm >= 0.3) {
          reasons.push({ w: tTerm, label: `Your vibe: ${matchedTags.slice(0, 2).map((m) => m.t).join(', ')}` });
        }
      }
    }

    // ── Quality prior (Bayesian) ──
    // Shrink the star rating toward the 3.8 baseline by review count, so a
    // 4.6 backed by a thousand reviews beats a 5.0 backed by three.
    if (c.rating > 0) {
      const v = c.userRatingCount || 0;
      const bayes = (v * c.rating + 25 * 3.8) / (v + 25);
      const q = clamp(bayes - 3.8, -1, 1);
      const qTerm = W.quality * q;
      score += qTerm;
      if (q >= 0.55 && v >= 150) {
        reasons.push({ w: qTerm, label: `${c.rating.toFixed(1)}★ from ${formatReviewCount(v)} reviews` });
      }
    }
    score += W.popularity * Math.min(1, Math.log1p(c.userRatingCount || 0) / Math.log1p(3000));

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
      score += eTerm;
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
      score += fTerm;
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
      score += W.wishlist;
      reasons.push({ w: W.wishlist, label: 'On your wishlist' });
    }

    // ── Distance decay (soft, past half the radius; capped) ──
    const extra = Math.max(0, distKm - radiusKm * 0.5);
    score -= W.distance * Math.min(1.5, extra / Math.max(radiusKm, 0.5));

    reasons.sort((a, b) => b.w - a.w);
    const match = Math.round(clamp(100 / (1 + Math.exp(-score * 0.55)), 5, 99));
    scored.push({
      ...c,
      recScore: score,
      sources,
      reasons: reasons.slice(0, 3).map((r) => r.label),
      match,
    });
  }

  scored.sort((a, b) => b.recScore - a.recScore);
  return diversifyByCuisine(scored, inferCuisine).slice(0, limit);
}

/**
 * Full recommendation pipeline: candidate pool (Google text queries + cached
 * pool + community rows) → social signals → scoreCandidates. Unlike the old
 * version this ALWAYS ranks — a cache hit skips the Google spend, never the
 * scoring — so results always carry recScore / reasons / match, and the
 * social lifts stay current even when the pool comes from cache.
 */
export async function getRecommendations(opts: RecOptions): Promise<ScoredPlace[]> {
  const limit = opts.limit ?? 12;
  const maxQueries = opts.maxQueries ?? 5;
  const prefsHash =
    preferencesHash(opts.profile.topCuisines, opts.profile.topPrices) +
    '|r=' +
    opts.radiusMeters;
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

  if (opts.signal?.aborted) return [];

  const queries = skipGoogle
    ? []
    : buildCandidateQueries(opts.profile, opts.target).slice(0, maxQueries);

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
        searchPlacesByText(
          q,
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
  ]);

  if (opts.signal?.aborted) return [];

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
  const byId = new Map<string, PlaceResult>();
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

  // Post-filter by radius with 25% slack; the distance penalty handles the rest.
  const radiusKm = opts.radiusMeters / 1000;
  const slackKm = radiusKm * 1.25;
  const candidates: PlaceResult[] = [];
  for (const c of byId.values()) {
    const dist = haversineKm(
      { lat: c.lat, lng: c.lng },
      { lat: opts.target.lat, lng: opts.target.lng },
    );
    if (dist <= slackKm) candidates.push(c);
  }

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

  const scored = scoreCandidates(
    candidates,
    opts.profile,
    signals,
    opts.target,
    opts.radiusMeters,
    { limit, skipUserHistory: true, keepWishlisted: opts.keepWishlisted },
  );

  // Persist the ranked pool (not just a page of it) whenever we actually hit
  // Google, so the next open of the same city ranks instantly with zero
  // Places spend. Extra ScoredPlace fields serialize harmlessly and are
  // simply re-scored on the way back out of the cache.
  if (opts.userId && !skipGoogle && scored.length > 0) {
    void saveHomeRecsCache(
      opts.userId,
      locKey,
      opts.target.label,
      opts.target.lat,
      opts.target.lng,
      prefsHash,
      scored.slice(0, 60),
    );
  }

  return scored;
}
