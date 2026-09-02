/**
 * Loading the people in a group recommendation.
 *
 * A member is a taste profile plus the bits the group rules need (their
 * dietary answers, their home coordinates). The profile is built by the
 * SAME `buildTasteProfile` the signed-in user's own recommendations run
 * on — a friend is not a different kind of eater, just a different
 * history — so anything that improves the engine improves group picks
 * for free.
 *
 * What is read, and why it is allowed: `community_ratings` is the table
 * the feed already renders (a friend's ratings are visible to their
 * circle), and `taste_profile` is a column on the world-readable
 * `user_profiles` row. Nothing here reaches for anything the app doesn't
 * already show that viewer.
 */

import { getUserRatings, type CommunityRating, type UserProfile } from './supabase-community';
import { getTasteQuiz } from './taste-quiz';
import { buildTasteProfile, recsUnlocked } from './recommendations';
import type { GroupMember } from './group-recs';
import type { RestaurantRating } from '../contexts/ListsContext';

/**
 * A community row in the shape `buildTasteProfile` reads. The two types
 * describe the same event from different sides — the local library row vs
 * the shared table — so this is a rename, not a conversion, except for
 * `createdAt`, which the profile's recency decay needs as epoch millis.
 */
export function communityRatingToLocal(r: CommunityRating): RestaurantRating {
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
    tags: r.tags || [],
    photos: [],
    listIds: [],
    friendIds: [],
    createdAt: r.created_at ? new Date(r.created_at).getTime() : 0,
    updatedAt: r.updated_at ? new Date(r.updated_at).getTime() : 0,
  } as RestaurantRating;
}

/**
 * Build one member. `cold` is the honest flag: under the engine's own
 * threshold their ranking isn't personalized, and the UI must say that
 * rather than let a thin profile read as quiet agreement.
 *
 * A cold member still contributes — their taste-quiz answers seed the
 * profile exactly as they do for a new account's own recommendations.
 */
export async function loadGroupMember(profile: UserProfile): Promise<GroupMember> {
  const rows = await getUserRatings(profile.user_id);
  const ratings = rows.map(communityRatingToLocal).filter((r) => r.score > 0);
  const quiz = getTasteQuizFor(profile);
  return {
    userId: profile.user_id,
    name: profile.display_name || profile.username || 'Friend',
    profile: buildTasteProfile(ratings, [], [], [], quiz),
    dietary: quiz?.dietary,
    cold: !recsUnlocked(ratings.length),
  };
}

/** Their quiz answers only — never the local mirror, which belongs to
 *  whoever is holding the phone. `getTasteQuiz` falls back to local
 *  storage when a profile carries none, which would quietly hand YOUR
 *  dietary answers to a friend's row. */
function getTasteQuizFor(profile: UserProfile) {
  if (!profile.taste_profile) return null;
  return getTasteQuiz(profile);
}

/** Load several at once. Order is preserved so the UI's avatar row and
 *  the score's `fits` array line up. */
export async function loadGroupMembers(profiles: UserProfile[]): Promise<GroupMember[]> {
  return Promise.all(profiles.map(loadGroupMember));
}
