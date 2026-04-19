import type { PlaceResult } from './places';
import { extractCityState } from './places';
import type { CommunityRating } from './supabase-community';
import type { RestaurantRating, WishlistItem, CustomList } from '../contexts/ListsContext';

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
