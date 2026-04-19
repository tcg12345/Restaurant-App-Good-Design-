import type { PlaceResult } from './places';
import { extractCityState, CUISINE_TYPES, searchPlacesByText } from './places';
import type { CommunityRating } from './supabase-community';
import { getExpertRatings, getAllFriendRatings, getExpertProfiles } from './supabase-community';
import { locationKey, preferencesHash, getHomeRecsCache, saveHomeRecsCache } from './supabase-rec-cache';
import type { RestaurantRating, WishlistItem, CustomList } from '../contexts/ListsContext';

// Stubs — real implementations land in the next commit.
const getTagSimilarRestaurants = async (
  _topTags: string[],
  _locationLabel: string,
  _viewerId: string,
  _limit: number,
): Promise<CommunityRating[]> => [];

const getFollowedExpertIds = async (_userId: string): Promise<Set<string>> =>
  new Set<string>();

export interface TasteProfile {
  cuisineScore: Record<string, number>;
  priceScore: Record<number, number>;
  pairScore: Record<string, number>;         // "cuisine|price"
  tagScore: Record<string, number>;
  cityScore: Record<string, number>;
  topCuisines: string[];
  topPrices: number[];
  topPairs: { cuisine: string; price: number }[];
  topTags: string[];
  topCities: string[];
  highRatedCount: number;
  ratedIds: Set<string>;
  wishlistedIds: Set<string>;
  recentlyViewedIds: Set<string>;
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
}

export interface ScoredPlace extends PlaceResult {
  recScore: number;
  sources: Array<'google' | 'tagSimilar' | 'expert' | 'friend' | 'expertRec'>;
}

export const DEFAULT_WEIGHTS = {
  cuisine: 1.0,
  price: 0.6,
  pair: 1.5,
  tagOverlap: 1.2,
  popularity: 0.2,
  quality: 0.4,
  expert: 0.8,
  friend: 0.5,
  distancePerKm: 0.05,     // soft: applies to distance beyond 50% of the radius
  negativePair: 2.0,
} as const;

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
  let highRatedCount = 0;

  for (const r of ratings) {
    if (r.score <= 0) continue;
    const centered = r.score - 7;
    const weight = centered >= 0 ? centered + 1 : centered * 1.25;
    const price = r.price.length;

    if (r.cuisine) {
      cuisineScore[r.cuisine] = (cuisineScore[r.cuisine] || 0) + weight;
      if (price > 0) {
        const key = `${r.cuisine}|${price}`;
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

  for (const w of wishlist) {
    const price = w.price.length;
    if (w.cuisine && price > 0) {
      cuisineScore[w.cuisine] = (cuisineScore[w.cuisine] || 0) + 0.5;
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
    pairScore,
    tagScore,
    cityScore,
    topCuisines,
    topPrices,
    topPairs,
    topTags,
    topCities,
    highRatedCount,
    ratedIds,
    wishlistedIds,
    recentlyViewedIds,
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

function haversineKm(
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

export function scoreCandidates(
  candidates: PlaceResult[],
  profile: TasteProfile,
  signals: CandidateSignals,
  target: RecTargetLocation,
  radiusMeters: number,
): ScoredPlace[] {
  const W = DEFAULT_WEIGHTS;

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

  const coldStart = profile.highRatedCount < 3;
  const radiusKm = radiusMeters / 1000;
  const skipIds = new Set<string>();
  profile.ratedIds.forEach((id) => skipIds.add(id));
  profile.wishlistedIds.forEach((id) => skipIds.add(id));
  profile.recentlyViewedIds.forEach((id) => skipIds.add(id));

  const scored: ScoredPlace[] = [];

  for (const c of candidates) {
    if (skipIds.has(c.id)) continue;

    const cuisine = inferCuisine(c.types);
    const price = c.priceLevel;
    const pairKey = `${cuisine}|${price}`;
    const distKm = haversineKm(
      { lat: c.lat, lng: c.lng },
      { lat: target.lat, lng: target.lng },
    );
    const communityRows = signals.communityByRestaurant.get(c.id) || [];

    let score = 0;
    const sources: ScoredPlace['sources'] = ['google'];

    if (!coldStart) {
      score += W.cuisine * (profile.cuisineScore[cuisine] ?? 0);
      score += W.price * (profile.priceScore[price] ?? 0);
      score += W.pair * (profile.pairScore[pairKey] ?? 0);

      // Tag overlap (capped)
      const tagSet = new Set<string>();
      for (const row of communityRows) {
        for (const t of row.tags || []) tagSet.add(t);
      }
      let tagBonus = 0;
      for (const t of tagSet) {
        const ts = profile.tagScore[t];
        if (ts !== undefined) tagBonus += W.tagOverlap * ts;
      }
      const tagCap = W.tagOverlap * 6;
      if (tagBonus > tagCap) tagBonus = tagCap;
      score += tagBonus;
      if (tagBonus > 0) sources.push('tagSimilar');

      // Negative pair suppression
      const pairVal = profile.pairScore[pairKey] ?? 0;
      if (pairVal < 0) score -= W.negativePair * Math.abs(pairVal);

      score += W.popularity * Math.log1p(c.userRatingCount);
      score += W.quality * (c.rating - 3.5);
    } else {
      score += W.quality * (c.rating - 3.5);
      score += W.popularity * Math.log1p(c.userRatingCount);
    }

    // Expert signal
    let expertRaw = 0;
    for (const row of communityRows) {
      if (row.score >= 8 && signals.expertUserIds.has(row.user_id)) {
        const mult = signals.followedExpertIds.has(row.user_id) ? 0.75 : 0.5;
        expertRaw += mult;
      }
    }
    const hasExpertRec = signals.expertRecRestaurantIds.has(c.id);
    if (hasExpertRec) expertRaw += 1;
    if (expertRaw > 3) expertRaw = 3;
    const expertContribution = W.expert * expertRaw;
    if (expertContribution > 0) {
      score += expertContribution;
      sources.push('expert');
      if (hasExpertRec) sources.push('expertRec');
    }

    // Friend signal
    let friendRaw = 0;
    for (const row of communityRows) {
      if (row.score >= 8 && signals.friendUserIds.has(row.user_id)) {
        friendRaw += 0.3;
      }
    }
    if (friendRaw > 2) friendRaw = 2;
    const friendContribution = W.friend * friendRaw;
    if (friendContribution > 0) {
      score += friendContribution;
      sources.push('friend');
    }

    // Distance penalty (soft, beyond 50% of radius)
    const extra = Math.max(0, distKm - radiusKm * 0.5);
    score -= W.distancePerKm * extra;

    scored.push({ ...c, recScore: score, sources });
  }

  scored.sort((a, b) => b.recScore - a.recScore);

  // Diversity pass: in top 10, penalize 4th+ occurrence of the same cuisine
  const cuisineCounts: Record<string, number> = {};
  const top = Math.min(10, scored.length);
  for (let i = 0; i < top; i++) {
    const cu = inferCuisine(scored[i].types);
    cuisineCounts[cu] = (cuisineCounts[cu] || 0) + 1;
    if (cuisineCounts[cu] >= 4) {
      scored[i].recScore -= 1.5;
    }
  }
  scored.sort((a, b) => b.recScore - a.recScore);

  return scored.slice(0, 12);
}

function shuffleInPlace<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export async function getRecommendations(opts: RecOptions): Promise<ScoredPlace[]> {
  const prefsHash =
    preferencesHash(opts.profile.topCuisines, opts.profile.topPrices) +
    '|r=' +
    opts.radiusMeters;
  const locKey = locationKey(opts.target.lat, opts.target.lng);

  let mergeCached: PlaceResult[] = [];
  if (opts.userId) {
    const cached = await getHomeRecsCache(opts.userId, locKey);
    if (cached) {
      const ageMs = Date.now() - cached.updatedAt;
      const fresh = ageMs < 2 * 24 * 60 * 60 * 1000;
      if (fresh && cached.preferencesHash === prefsHash) {
        const shuffled = shuffleInPlace([...cached.places]);
        return shuffled.slice(0, 12).map((p) => ({
          ...p,
          recScore: 0,
          sources: ['google'] as ScoredPlace['sources'],
        }));
      }
      if (fresh) mergeCached = cached.places;
    }
  }

  if (opts.signal?.aborted) return [];

  const queries = buildCandidateQueries(opts.profile, opts.target).slice(0, 5);

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

  const signals: CandidateSignals = {
    expertUserIds,
    followedExpertIds: followedExperts,
    friendUserIds,
    communityByRestaurant,
    expertRecRestaurantIds: new Set<string>(),
  };

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
  for (const row of allCommunityRows) {
    if (byId.has(row.restaurant_id)) continue;
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
      types: [],
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

  const scored = scoreCandidates(
    candidates,
    opts.profile,
    signals,
    opts.target,
    opts.radiusMeters,
  );
  const top12 = scored.slice(0, 12);

  if (opts.userId) {
    void saveHomeRecsCache(
      opts.userId,
      locKey,
      opts.target.label,
      opts.target.lat,
      opts.target.lng,
      prefsHash,
      top12,
    );
  }

  return top12;
}
