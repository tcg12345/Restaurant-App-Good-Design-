import type { PlaceResult } from './places';
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
