/**
 * A taste profile for someone ELSE, from what the community table lets
 * you see of them.
 *
 * Your own profile is built from the full local rating (lib/useTasteProfile);
 * another person's has to come from community_ratings — the same rows
 * their public feed shows — plus their community photos. RLS already
 * enforces who may read those (public account, or an accepted follow),
 * so a viewer who can't see the person simply gets no rows here.
 *
 * Both the public-profile card and the /user/:username/taste page build
 * from this one function, so they can't disagree.
 */
import type { CommunityRating, CommunityPhoto } from './supabase-community';
import type { RestaurantRating, PhotoItem } from '../contexts/ListsContext';
import { buildTasteProfile } from './recommendations';
import { getTasteQuiz } from './taste-quiz';
import { buildTasteInsights, type MichelinHit, type TasteInsights } from './taste-insights';
import { statsFromRatings, tastePoints, tierFor, type TastePoints, type TierStanding } from './taste-tier';
import { findMichelinMatchSync } from './michelin';

export interface TasteState {
  insights: TasteInsights;
  points: TastePoints;
  standing: TierStanding;
  ratingCount: number;
}

/** Community rows → the rating shape the taste engine reads. Photos are
 *  grouped back onto their restaurant so photo counts and the "with
 *  photos" habit come out the same as they do for the owner. */
export function communityRowsToRatings(rows: CommunityRating[], photos: CommunityPhoto[]): RestaurantRating[] {
  const byRestaurant = new Map<string, PhotoItem[]>();
  for (const p of photos) {
    const list = byRestaurant.get(p.restaurant_id) ?? [];
    list.push({ url: p.url, caption: p.caption ?? '', isFavorite: !!p.is_favorite });
    byRestaurant.set(p.restaurant_id, list);
  }
  return rows.map((r) => {
    const created = Date.parse(r.created_at);
    const method = r.rating_method === 'h2h' || r.rating_method === 'slider' || r.rating_method === 'import' ? r.rating_method : undefined;
    return {
      restaurantId: r.restaurant_id,
      name: r.restaurant_name,
      image: r.photo_url || '',
      cuisine: r.cuisine || '',
      price: r.price || '',
      address: r.address || '',
      score: Number(r.score) || 0,
      notes: r.notes || '',
      visitDate: r.visit_date || '',
      wouldReturn: r.would_return ?? true,
      tags: r.tags ?? [],
      photos: byRestaurant.get(r.restaurant_id) ?? [],
      listIds: [],
      friendIds: r.friend_ids ?? [],
      createdAt: Number.isFinite(created) ? created : 0,
      ratingMethod: method,
    };
  });
}

export function buildTasteStateFromCommunity(args: {
  rows: CommunityRating[];
  photos: CommunityPhoto[];
  profile: { taste_profile?: unknown } | null;
  /** Whether the Michelin dataset is in memory (useMichelinIndexReady). */
  michelinReady: boolean;
  /** The person's display name — every sentence is written about them. */
  name: string;
}): TasteState {
  const ratings = communityRowsToRatings(args.rows, args.photos);
  const coordsById = new Map<string, { lat: number; lng: number }>();
  for (const r of args.rows) {
    if (typeof r.lat === 'number' && typeof r.lng === 'number') coordsById.set(r.restaurant_id, { lat: r.lat, lng: r.lng });
  }
  const quiz = getTasteQuiz(args.profile);
  const profile = buildTasteProfile(ratings, [], [], [], quiz, { coordsById });
  let michelinById: Map<string, MichelinHit> | undefined;
  if (args.michelinReady) {
    michelinById = new Map();
    for (const r of ratings) {
      const at = coordsById.get(r.restaurantId);
      const info = findMichelinMatchSync(r.name, at?.lat, at?.lng, r.address);
      if (info) michelinById.set(r.restaurantId, { stars: info.stars, bibGourmand: info.bibGourmand });
    }
  }
  const insights = buildTasteInsights(ratings, profile, { quiz, michelinById, voice: { name: args.name } });
  const points = tastePoints(statsFromRatings(ratings));
  return { insights, points, standing: tierFor(points.total), ratingCount: ratings.length };
}
