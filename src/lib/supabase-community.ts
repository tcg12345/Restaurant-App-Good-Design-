/**
 * Community ratings & photos — shared data across all users.
 */
import { supabase, supabaseConfigured } from './supabase';
import type { PinnedItem } from './pins';
import { rankSuggestedProfiles, diversifySuggestions, tasteMatchScore, tasteMatchReason, type TasteSignal } from './suggestions';
import { reportClientError } from './error-reporting';
import { buildRatingPayload, type ActivityStamp, type RatingPayloadData } from './ratingPayload';
import type { HomeMeal } from '../contexts/ListsContext';

export type { ActivityStamp } from './ratingPayload';

export interface CommunityRating {
  id: string;
  user_id: string;
  restaurant_id: string;
  restaurant_name: string;
  score: number;
  notes: string;
  cuisine: string;
  price: string;
  address: string;
  visit_date: string;
  tags: string[];
  would_return: boolean;
  friend_ids: string[];
  lat: number | null;
  lng: number | null;
  photo_url: string;
  created_at: string;
  /** Last-updated timestamp. Present on the row (getUserRatings /
   *  getExpertRatings order by it); optional here for older callers that
   *  build CommunityRating objects without it. */
  updated_at?: string;
  /** How the score was produced: 'h2h' | 'import' | 'slider' | null.
   *  NULL = pre-tracking legacy (contributes). 'slider' rows stay visible
   *  as individual reviews but never count toward averages, rater counts,
   *  or recommendation signals — see countsForCommunity(). */
  rating_method?: string | null;
}

/** Whether a community row contributes to averaged/counted numbers and
 *  recommendation signals. Self-picked slider scores don't — they aren't
 *  calibrated against anything. NULL (legacy) and 'h2h'/'import' do. */
export function countsForCommunity(r: { rating_method?: string | null }): boolean {
  return r.rating_method !== 'slider';
}

/**
 * The timestamp a feed row sorts and is LABELED by. Feed fetch windows
 * order/limit by updated_at, so sorting or captioning by created_at let an
 * edited 2-year-old review float to the top labeled "2 years ago" while
 * genuinely new rows got evicted from the window.
 */
export function activityTimestamp(r: { created_at?: string; updated_at?: string }): string {
  return r.updated_at || r.created_at || '';
}

/** True when a row was meaningfully edited after creation (> 60 s) — feeds
 *  append an "edited" marker so the updated_at-based recency reads honestly. */
export function isEditedActivity(r: { created_at?: string; updated_at?: string }): boolean {
  if (!r.created_at || !r.updated_at) return false;
  const c = Date.parse(r.created_at);
  const u = Date.parse(r.updated_at);
  return Number.isFinite(c) && Number.isFinite(u) && u - c > 60_000;
}

export interface CommunityPhoto {
  id: string;
  user_id: string;
  restaurant_id: string;
  url: string;
  caption: string;
  is_favorite: boolean;
  created_at: string;
}

export interface CommunityStats {
  avgScore: number;
  totalRatings: number;
  ratings: CommunityRating[];
}

export interface FriendsStats {
  avgScore: number;
  totalRatings: number;
  ratings: CommunityRating[];
}

/**
 * Publish a user's rating to the community table (called when user rates a restaurant).
 */
/**
 * Upsert a user's rating into the community table.
 *
 * `activityAt` decides whether this write counts as rating activity —
 * i.e. whether it resurfaces in every friend's feed. It defaults to
 * "no", because most callers here are housekeeping (coordinates, a
 * settle nudge, a device re-sync) and none of that is news. See
 * lib/ratingPayload for the full reasoning.
 */
export async function publishCommunityRating(
  userId: string,
  restaurantId: string,
  data: RatingPayloadData,
  activityAt: ActivityStamp = undefined,
): Promise<string | null> {
  if (!supabaseConfigured || !userId) return null;
  try {
    const payload = buildRatingPayload(userId, restaurantId, data, activityAt);
    // Return the row id: publishing a rating as a post needs it to stamp
    // posts.rating_id, which is what keeps one meal to one feed card.
    const { data: row, error } = await supabase.from('community_ratings')
      .upsert(payload, { onConflict: 'user_id,restaurant_id' })
      .select('id')
      .single();
    if (error) { console.error('[Community] publishRating error:', error); return null; }
    return row?.id ? String(row.id) : null;
  } catch (err) { console.error('[Community] publishRating exception:', err); return null; }
}

/**
 * Remove a user's community rating (when they delete their rating).
 */
export async function removeCommunityRating(userId: string, restaurantId: string): Promise<boolean> {
  if (!supabaseConfigured || !userId) return false;
  try {
    const { error } = await supabase.from('community_ratings')
      .delete().eq('user_id', userId).eq('restaurant_id', restaurantId);
    if (error) { console.error('[Community] removeRating error:', error); return false; }
    return true;
  } catch (err) { console.error('[Community] removeRating exception:', err); return false; }
}

/**
 * Get community stats for a restaurant (all users' ratings).
 */
export async function getCommunityStats(restaurantId: string): Promise<CommunityStats> {
  if (!supabaseConfigured) return { avgScore: 0, totalRatings: 0, ratings: [] };
  try {
    const { data, error } = await supabase.from('community_ratings')
      .select('*').eq('restaurant_id', restaurantId).order('created_at', { ascending: false });
    if (error) { console.error('[Community] getStats error:', error); return { avgScore: 0, totalRatings: 0, ratings: [] }; }
    const ratings = (data || []) as CommunityRating[];
    // All rows come back (individual reviews stay visible) but only
    // contributing ones move the average/count — a slider-only restaurant
    // reads as having no community score.
    const counted = ratings.filter(countsForCommunity);
    const avgScore = counted.length > 0 ? counted.reduce((sum, r) => sum + Number(r.score), 0) / counted.length : 0;
    return { avgScore, totalRatings: counted.length, ratings };
  } catch (err) { console.error('[Community] getStats exception:', err); return { avgScore: 0, totalRatings: 0, ratings: [] }; }
}

/**
 * Return the most common community-supplied price (mode of `price`)
 * for each restaurant id passed in. Batches the lookup into a single
 * query so the Discover rail can resolve up to ~30 fallbacks in one
 * round trip. Restaurants with no community ratings are omitted from
 * the returned map.
 */
export async function getCommunityPricesForPlaces(
  restaurantIds: string[],
): Promise<Record<string, string>> {
  if (!supabaseConfigured) return {};
  const ids = Array.from(new Set(restaurantIds.filter(Boolean)));
  if (ids.length === 0) return {};
  try {
    const { data, error } = await supabase
      .from('community_ratings')
      .select('restaurant_id, price')
      .in('restaurant_id', ids)
      .not('price', 'is', null);
    if (error) { console.error('[Community] getCommunityPricesForPlaces error:', error); return {}; }
    // Group by restaurant_id → tally each price string. The "$$$" /
    // "$$$$" form is what we'll display so we use it verbatim — no
    // need to normalise into a numeric tier first.
    const tally: Record<string, Record<string, number>> = {};
    for (const row of (data || []) as Array<{ restaurant_id: string; price: string | null }>) {
      const p = (row.price || '').trim();
      if (!p) continue;
      const bucket = tally[row.restaurant_id] || (tally[row.restaurant_id] = {});
      bucket[p] = (bucket[p] || 0) + 1;
    }
    const out: Record<string, string> = {};
    for (const [rid, counts] of Object.entries(tally)) {
      let best = '';
      let bestN = 0;
      for (const [price, n] of Object.entries(counts)) {
        if (n > bestN) { best = price; bestN = n; }
      }
      if (best) out[rid] = best;
    }
    return out;
  } catch (err) {
    console.error('[Community] getCommunityPricesForPlaces exception:', err);
    return {};
  }
}

export interface CommunityRatingStats {
  /** Distinct app users who rated the place (one enthusiast logging five
   *  visits still reads as one fan). */
  raters: number;
  /** Mean community score, 0–10. */
  avgScore: number;
}

/**
 * Rating stats per restaurant across ALL community ratings — the "popular on
 * this app" signal AND the community-quality source the recommendation
 * engine hands over to as the platform grows (today's tiny sample means the
 * Google rating still carries quality; that shifts automatically). One
 * batched query; restaurants nobody has rated are omitted.
 */
export async function getCommunityRatingStats(
  restaurantIds: string[],
): Promise<Record<string, CommunityRatingStats>> {
  if (!supabaseConfigured) return {};
  const ids = Array.from(new Set(restaurantIds.filter(Boolean)));
  if (ids.length === 0) return {};
  try {
    const { data, error } = await supabase
      .from('community_ratings')
      .select('restaurant_id, user_id, score, rating_method')
      .in('restaurant_id', ids);
    if (error) { console.error('[Community] getCommunityRatingStats error:', error); return {}; }
    const acc: Record<string, { users: Set<string>; sum: number; n: number }> = {};
    for (const row of (data || []) as Array<{ restaurant_id: string; user_id: string; score: number | null; rating_method?: string | null }>) {
      if (!countsForCommunity(row)) continue; // self-picked scores never feed signals
      const slot = acc[row.restaurant_id] || (acc[row.restaurant_id] = { users: new Set(), sum: 0, n: 0 });
      slot.users.add(row.user_id);
      if (typeof row.score === 'number' && row.score > 0) {
        slot.sum += row.score;
        slot.n++;
      }
    }
    const out: Record<string, CommunityRatingStats> = {};
    for (const [rid, slot] of Object.entries(acc)) {
      out[rid] = { raters: slot.users.size, avgScore: slot.n > 0 ? slot.sum / slot.n : 0 };
    }
    return out;
  } catch (err) {
    console.error('[Community] getCommunityRatingStats exception:', err);
    return {};
  }
}

/**
 * Get friends' ratings for a restaurant.
 */
export async function getFriendsStats(userId: string, restaurantId: string): Promise<FriendsStats> {
  if (!supabaseConfigured || !userId) return { avgScore: 0, totalRatings: 0, ratings: [] };
  try {
    // Get friend IDs
    const { data: friends } = await supabase.from('user_friends')
      .select('friend_id').eq('user_id', userId);
    const friendIds = (friends || []).map((f: any) => f.friend_id);
    if (friendIds.length === 0) return { avgScore: 0, totalRatings: 0, ratings: [] };

    // Get friends' ratings for this restaurant
    const { data, error } = await supabase.from('community_ratings')
      .select('*').eq('restaurant_id', restaurantId).in('user_id', friendIds)
      .order('created_at', { ascending: false });
    if (error) { console.error('[Community] getFriendsStats error:', error); return { avgScore: 0, totalRatings: 0, ratings: [] }; }
    const ratings = (data || []) as CommunityRating[];
    // Same contract as getCommunityStats: every row visible, only
    // contributing rows averaged/counted.
    const counted = ratings.filter(countsForCommunity);
    const avgScore = counted.length > 0 ? counted.reduce((sum, r) => sum + Number(r.score), 0) / counted.length : 0;
    return { avgScore, totalRatings: counted.length, ratings };
  } catch (err) { console.error('[Community] getFriendsStats exception:', err); return { avgScore: 0, totalRatings: 0, ratings: [] }; }
}

export interface CircleRatingHit {
  username: string;
  displayName?: string;
  isExpert?: boolean;
  isFriend?: boolean;
  score?: number;
  notes?: string;
}

/**
 * Friends' + verified experts' ratings for ONE restaurant — the global,
 * page-independent implementation behind the assistant's get_circle_ratings
 * tool. LocationPage overrides it with its preloaded signals map; every
 * other surface runs this direct query so the model never asserts "no one
 * in your circle rated this" from an unwired stub.
 */
export async function getCircleRatingsForRestaurant(
  userId: string | null | undefined,
  restaurantId: string,
): Promise<CircleRatingHit[]> {
  const id = restaurantId.trim();
  if (!supabaseConfigured || !id) return [];
  try {
    const [friendRes, ratingRes] = await Promise.all([
      userId
        ? supabase.from('user_friends').select('friend_id').eq('user_id', userId)
        : Promise.resolve({ data: [] as Array<{ friend_id: string }> }),
      supabase.from('community_ratings')
        .select('*')
        .eq('restaurant_id', id)
        .order('created_at', { ascending: false })
        .limit(100),
    ]);
    if (ratingRes.error) {
      console.warn('[Community] getCircleRatingsForRestaurant error:', ratingRes.error.message);
      return [];
    }
    const friendIds = new Set(((friendRes.data || []) as Array<{ friend_id: string }>).map((f) => f.friend_id));
    const rows = (ratingRes.data || []) as CommunityRating[];
    if (rows.length === 0) return [];
    const raterIds = Array.from(new Set(rows.map((r) => r.user_id)));
    const profiles = await getProfilesByIds(raterIds);
    return rows
      .filter((r) => friendIds.has(r.user_id) || !!profiles[r.user_id]?.is_verified)
      .map((r) => {
        const prof = profiles[r.user_id];
        const score = Number(r.score);
        return {
          username: prof?.username || '',
          displayName: prof?.display_name || prof?.username || 'Unknown',
          isExpert: !!prof?.is_verified,
          isFriend: friendIds.has(r.user_id),
          score: Number.isFinite(score) && score > 0 ? score : undefined,
          notes: r.notes || undefined,
        };
      });
  } catch (err) {
    console.warn('[Community] getCircleRatingsForRestaurant exception:', err);
    return [];
  }
}

/**
 * Remove a user's community photos for a restaurant.
 */
export async function removeCommunityPhotos(userId: string, restaurantId: string): Promise<boolean> {
  if (!supabaseConfigured || !userId) return false;
  try {
    // The error was previously discarded and `true` returned regardless, so a
    // failed delete (offline, RLS, transient) looked exactly like a success —
    // and nothing retried, because nothing knew. Orphaned galleries outlive
    // the rating that owned them that way; `reconcileCommunityRows` is the
    // net that catches whatever still slips through.
    const { error } = await supabase.from('community_photos')
      .delete().eq('user_id', userId).eq('restaurant_id', restaurantId);
    if (error) { console.error('[Community] removePhotos error:', error); return false; }
    return true;
  } catch (err) { console.error('[Community] removePhotos exception:', err); return false; }
}

/**
 * Every restaurant this user has a published community row for — ratings and
 * photo galleries alike.
 *
 * Used by the delete reconciliation: the app's source of truth is the local
 * ratings list, so any id here that ISN'T in that list is a leftover from a
 * deletion whose cleanup didn't land.
 */
export async function listMyCommunityRestaurantIds(
  userId: string,
): Promise<{ ratings: string[]; photos: string[] }> {
  if (!supabaseConfigured || !userId) return { ratings: [], photos: [] };
  try {
    const [r, p] = await Promise.all([
      supabase.from('community_ratings').select('restaurant_id').eq('user_id', userId),
      supabase.from('community_photos').select('restaurant_id').eq('user_id', userId),
    ]);
    const ids = (rows: { restaurant_id: string }[] | null) =>
      [...new Set((rows ?? []).map((x) => x.restaurant_id).filter(Boolean))];
    return { ratings: ids(r.data), photos: ids(p.data) };
  } catch (err) {
    console.error('[Community] listMyCommunityRestaurantIds exception:', err);
    return { ratings: [], photos: [] };
  }
}

/** The Storage URLs this user published for `restaurantIds`, so the objects
 *  behind them can be removed along with the rows. */
export async function getMyCommunityPhotoUrls(
  userId: string, restaurantIds: string[],
): Promise<string[]> {
  if (!supabaseConfigured || !userId || restaurantIds.length === 0) return [];
  try {
    const { data } = await supabase.from('community_photos')
      .select('url').eq('user_id', userId).in('restaurant_id', restaurantIds);
    return (data ?? []).map((r: { url: string }) => r.url).filter(Boolean);
  } catch { return []; }
}

/**
 * Publish user photos to the community gallery.
 */
export async function publishCommunityPhotos(
  userId: string, restaurantId: string, photos: { url: string; caption: string; isFavorite: boolean }[]
): Promise<boolean> {
  if (!supabaseConfigured || !userId) return false;
  try {
    // Replace semantics: always clear this user's existing rows for the
    // restaurant first, so photos removed from the review disappear from
    // the community gallery. An empty list therefore means "remove all" —
    // the old early-return on empty input was how stale photos survived
    // review edits and kept haunting restaurant pages.
    await supabase.from('community_photos').delete().eq('user_id', userId).eq('restaurant_id', restaurantId);
    if (photos.length === 0) return true;
    // Insert new ones
    const rows = photos.map((p) => ({
      user_id: userId, restaurant_id: restaurantId,
      url: p.url, caption: p.caption, is_favorite: p.isFavorite,
    }));
    const { error } = await supabase.from('community_photos').insert(rows);
    if (error) { console.error('[Community] publishPhotos error:', error); return false; }
    return true;
  } catch (err) { console.error('[Community] publishPhotos exception:', err); return false; }
}

/**
 * Get community photos for a restaurant.
 */
export async function getCommunityPhotos(restaurantId: string, limit?: number, offset?: number): Promise<CommunityPhoto[]> {
  if (!supabaseConfigured) return [];
  try {
    // Favourite first, then most-recent — so a `limit: 1` cover fetch returns
    // the same lead photo the full list would, letting the hero paint from a
    // single tiny request while the rest loads in the background. The photos
    // are large base64 blobs, so callers page through them (limit + offset)
    // rather than pulling every row in one response that can time out.
    let q = supabase.from('community_photos')
      .select('*').eq('restaurant_id', restaurantId)
      .order('is_favorite', { ascending: false })
      .order('created_at', { ascending: false });
    if (offset != null && limit && limit > 0) q = q.range(offset, offset + limit - 1);
    else if (limit && limit > 0) q = q.limit(limit);
    const { data, error } = await q;
    if (error) { console.error('[Community] getPhotos error:', error); return []; }
    return (data || []) as CommunityPhoto[];
  } catch (err) { console.error('[Community] getPhotos exception:', err); return []; }
}

/**
 * Pick a single "cover" photo for a batch of restaurants in one query.
 * Returns a map of restaurant_id → photo URL with this priority (highest
 * wins):
 *   1. A photo uploaded by the current viewer themselves — most recent first.
 *   2. Any user's photo flagged is_favorite — most recent first.
 *   3. The first (oldest) photo uploaded by anyone.
 *
 * Restaurants with no community photos at all are absent from the result
 * so callers can fall back to the "No photos yet" placeholder.
 */
export async function getCoverPhotosBatch(
  restaurantIds: string[],
  currentUserId: string | null,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  if (!supabaseConfigured || restaurantIds.length === 0) return out;
  try {
    // community_photos is world-readable, so we can fetch every photo for
    // every restaurant in one query and pick a winner per bucket in JS.
    const { data, error } = await supabase
      .from('community_photos')
      .select('restaurant_id, user_id, url, is_favorite, created_at')
      .in('restaurant_id', restaurantIds);
    if (error || !data) return out;

    const buckets: Record<string, any[]> = {};
    for (const row of data as any[]) {
      const id = row.restaurant_id as string;
      if (!buckets[id]) buckets[id] = [];
      buckets[id].push(row);
    }
    for (const [id, rows] of Object.entries(buckets)) {
      if (rows.length === 0) continue;
      const mine = currentUserId
        ? rows.filter((r) => r.user_id === currentUserId)
        : [];
      if (mine.length > 0) {
        mine.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        out[id] = mine[0].url;
        continue;
      }
      const favorites = rows.filter((r) => r.is_favorite);
      if (favorites.length > 0) {
        favorites.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        out[id] = favorites[0].url;
        continue;
      }
      const oldest = [...rows].sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
      );
      out[id] = oldest[0].url;
    }
    return out;
  } catch (err) {
    console.warn('[Community] getCoverPhotosBatch error:', err);
    return out;
  }
}

/* ── User Profiles ── */

export interface UserProfile {
  user_id: string;
  display_name: string;
  username: string;
  bio: string;
  is_public: boolean;
  /** Legacy self-assigned flag — kept in the row for old clients but no
   *  longer written by this app. Read `is_verified` instead. */
  is_expert: boolean;
  /** Owner-approved verified badge. Granted only through the
   *  verification-request flow (see supabase-verification.ts); a DB
   *  trigger silently ignores client-side writes to it. */
  is_verified: boolean;
  /** The verified user's self-chosen one-line public status
   *  ("Head chef at …"). Only present alongside is_verified. */
  verified_status?: string | null;
  /** Self-declared home base — surfaced on the Circle search page so
   *  users can tell where a verified user eats, and used by /location to
   *  find verified users based in the city being explored. */
  home_city?: string | null;
  home_lat?: number | null;
  home_lng?: number | null;
  /** Onboarding palette-test answers (migration 059) — written by
   *  lib/taste-quiz.ts, blended into recommendations as cold-start priors. */
  taste_profile?: unknown;
  /** Public URL of the user's profile photo (migration 074), living in the
   *  same `photos` bucket as every other user image. Null/absent means the
   *  generated monogram is the avatar — see components/Avatar.tsx. */
  avatar_url?: string | null;
  /** Up to three things pinned to the top of the profile (migration 085):
   *  references the profile pages resolve against data the viewer can
   *  already read. See lib/pins.ts. */
  pinned?: PinnedItem[] | null;
}

/** Optional home-base extras for {@link saveProfile}. Pass any subset; only
 *  fields with explicit values get written, so callers can leave the
 *  others alone instead of wiping them by accident. */
export interface SaveProfileHomeBase {
  homeCity?: string | null;
  homeLat?: number | null;
  homeLng?: number | null;
}

export async function getProfile(userId: string): Promise<UserProfile | null> {
  if (!supabaseConfigured || !userId) return null;
  try {
    const { data, error } = await supabase.from('user_profiles')
      .select('*').eq('user_id', userId).single();
    if (error) return null;
    return data as UserProfile;
  } catch { return null; }
}

/**
 * Like getProfile, but it can tell "no profile row exists" (resolves null)
 * apart from "the fetch failed" (THROWS). Auth boot uses this: a swallowed
 * network error used to read as "no profile", which routed an existing user
 * back into ProfileSetup — whose save then wiped their bio and flipped a
 * private account public.
 */
export async function fetchProfile(userId: string): Promise<UserProfile | null> {
  if (!supabaseConfigured || !userId) return null;
  const { data, error } = await supabase.from('user_profiles')
    .select('*').eq('user_id', userId).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as UserProfile | null) ?? null;
}

export async function getProfileByUsername(username: string): Promise<UserProfile | null> {
  if (!supabaseConfigured || !username.trim()) return null;
  try {
    const { data, error } = await supabase.from('user_profiles')
      .select('*').ilike('username', username.trim()).single();
    if (error) return null;
    return data as UserProfile;
  } catch { return null; }
}

/**
 * True when the username is already claimed by ANOTHER account. Head-count
 * query on the lowercased handle (saveProfile stores usernames lowercased),
 * so no profile rows cross the wire. Returns `null` when the check itself
 * fails (offline / RLS / timeout) — callers must treat that as "couldn't
 * tell" and fall back to the submit-time 23505 backstop, never as
 * "available".
 */
export async function isUsernameTaken(username: string, excludeUserId?: string): Promise<boolean | null> {
  const uname = username.toLowerCase().trim();
  if (!supabaseConfigured || !uname) return null;
  try {
    let q = supabase.from('user_profiles')
      .select('user_id', { count: 'exact', head: true })
      .eq('username', uname);
    if (excludeUserId) q = q.neq('user_id', excludeUserId);
    const { count, error } = await q;
    if (error) return null;
    return (count ?? 0) > 0;
  } catch { return null; }
}

/**
 * Profile columns the app can save without. Identity (user_id,
 * display_name, username, updated_at) is never in here — those must fail
 * loudly. See {@link missingSchemaColumn} for why this list exists.
 */
const OPTIONAL_PROFILE_COLUMNS = new Set([
  'home_city', 'home_lat', 'home_lng', 'bio', 'is_public', 'taste_profile',
  'avatar_url', 'pinned',
]);

/**
 * The column name inside PostgREST's "not in the schema cache" error, or
 * null when the error is something else.
 *
 * PostgREST rejects a write naming a column it doesn't know about — code
 * PGRST204, message `Could not find the 'home_city' column of
 * 'user_profiles' in the schema cache` — BEFORE the statement reaches
 * Postgres, so the whole row is lost, not just that field. Two things
 * produce it: a migration that never ran against this database, or a schema
 * cache that predates a column which does exist. Either way it used to fail
 * the entire profile save: a new user who typed a home city on the setup
 * wizard could never finish signup (skipping the city step worked, because
 * then the payload carried no home_* keys at all). Callers use this to drop
 * the unknown column and retry — an optional field must never cost someone
 * their account. See migration 067 for the database-side repair.
 */
export function missingSchemaColumn(error: { code?: string; message?: string } | null): string | null {
  if (!error) return null;
  const message = error.message ?? '';
  if (error.code !== 'PGRST204' && !/schema cache/i.test(message)) return null;
  return /'([^']+)' column/.exec(message)?.[1] ?? null;
}

export async function saveProfile(
  userId: string,
  displayName: string,
  username: string,
  bio?: string,
  isPublic?: boolean,
  homeBase?: SaveProfileHomeBase,
  /** Public URL of the profile photo, or null to clear it back to the
   *  monogram. Leave undefined to keep whatever is already stored. */
  avatarUrl?: string | null,
): Promise<{ success: boolean; error?: string; droppedColumns?: string[] }> {
  if (!supabaseConfigured || !userId) return { success: false, error: 'Not configured' };
  try {
    const payload: any = {
      user_id: userId, display_name: displayName, username: username.toLowerCase().trim(),
      updated_at: new Date().toISOString(),
    };
    if (bio !== undefined) payload.bio = bio;
    if (isPublic !== undefined) payload.is_public = isPublic;
    if (avatarUrl !== undefined) payload.avatar_url = avatarUrl;
    // is_verified / verified_status are never written here — verification
    // is granted via the approve RPC, and the status line goes through
    // saveVerifiedStatusLine (supabase-verification.ts).
    if (homeBase) {
      // Only assign keys that were explicitly provided so partial updates
      // don't clobber existing home-base values with undefined.
      if (homeBase.homeCity !== undefined) payload.home_city = homeBase.homeCity;
      if (homeBase.homeLat !== undefined) payload.home_lat = homeBase.homeLat;
      if (homeBase.homeLng !== undefined) payload.home_lng = homeBase.homeLng;
    }
    // Each PGRST204 names exactly one unknown column, so retry once per
    // optional column the payload carries (+1 for the final success).
    const droppedColumns: string[] = [];
    for (let attempt = 0; attempt <= OPTIONAL_PROFILE_COLUMNS.size; attempt++) {
      const { error } = await supabase.from('user_profiles').upsert(payload, { onConflict: 'user_id' });
      if (!error) {
        return droppedColumns.length ? { success: true, droppedColumns } : { success: true };
      }
      if (error.code === '23505') return { success: false, error: 'Username is already taken' };
      const missing = missingSchemaColumn(error);
      if (missing && OPTIONAL_PROFILE_COLUMNS.has(missing) && missing in payload) {
        // The database is behind the app. Save what it CAN store rather
        // than dead-ending the user, and leave a breadcrumb so the missing
        // migration gets noticed instead of silently costing profile data.
        delete payload[missing];
        droppedColumns.push(missing);
        reportClientError('saveProfile:unknown-column', new Error(error.message), missing);
        continue;
      }
      return { success: false, error: error.message };
    }
    return { success: false, error: 'Could not save your profile. Please try again.' };
  } catch (err) { return { success: false, error: String(err) }; }
}

/** Write the profile's pinned items (migration 085). Same unknown-column
 *  tolerance as saveProfile: on a database that hasn't run the migration
 *  the write fails softly and the caller keeps its local state. */
export async function savePinned(userId: string, pinned: PinnedItem[]): Promise<{ success: boolean; error?: string }> {
  if (!supabaseConfigured || !userId) return { success: false, error: 'Not configured' };
  try {
    const { error } = await supabase
      .from('user_profiles')
      .update({ pinned: pinned.slice(0, 3), updated_at: new Date().toISOString() })
      .eq('user_id', userId);
    if (!error) return { success: true };
    if (missingSchemaColumn(error) === 'pinned') {
      reportClientError('savePinned:unknown-column', new Error(error.message), 'pinned');
      return { success: false, error: 'Pins need a database update before they can be saved.' };
    }
    return { success: false, error: error.message };
  } catch (err) { return { success: false, error: String(err) }; }
}

/**
 * Fetch profiles whose declared home base sits within a lat/lng bounding
 * box. Used by /location to surface "experts in this area" /
 * "people in this area you might know" suggestion rows. Filters server-side
 * on (home_lat, home_lng) so we don't pull every profile across the wire.
 *
 * - `expertsOnly: true` narrows to is_expert profiles.
 * - `excludeUserIds` keeps the caller out of their own results and is
 *   also where you'd skip already-followed accounts.
 * - `limit` defaults to 20 so a single bbox query still pages cheaply.
 */
export async function getProfilesInArea(opts: {
  bbox: { latLow: number; latHigh: number; lngLow: number; lngHigh: number };
  expertsOnly?: boolean;
  excludeUserIds?: string[];
  limit?: number;
}): Promise<UserProfile[]> {
  if (!supabaseConfigured) return [];
  const { bbox, expertsOnly, excludeUserIds, limit } = opts;
  try {
    let q = supabase
      .from('user_profiles')
      .select('*')
      .gte('home_lat', bbox.latLow)
      .lte('home_lat', bbox.latHigh)
      .gte('home_lng', bbox.lngLow)
      .lte('home_lng', bbox.lngHigh)
      .limit(limit ?? 20);
    if (expertsOnly) q = q.eq('is_verified', true);
    if (excludeUserIds && excludeUserIds.length > 0) {
      // Postgrest doesn't accept .not('user_id', 'in', '(...)') with an
      // array directly in the JS client builder, so format manually.
      q = q.not('user_id', 'in', `(${excludeUserIds.map((id) => `"${id}"`).join(',')})`);
    }
    const { data, error } = await q;
    if (error) return [];
    return (data || []) as UserProfile[];
  } catch { return []; }
}

/**
 * People worth following, for a viewer whose feed would otherwise be empty.
 *
 * The rail that existed before this sourced from `getExpertProfiles()` —
 * verified accounts only. On a young platform there are none, so "Suggested
 * for you" could never show a single person, which is most of why a new
 * account's feed sat empty with nowhere to go from it. This draws from every
 * PUBLIC profile instead, and uses verification as a ranking boost rather
 * than an entry requirement.
 *
 * Ranked by what makes someone worth following rather than by recency:
 * verified first, then how much they have actually published (a profile with
 * forty ratings is a feed; one with zero is a blank page), then followers as
 * the tiebreak. `get_expert_stats` (migration 056) returns both counts for
 * the whole candidate set in one round-trip.
 *
 * Excludes the viewer, everyone they already follow, and everyone they have
 * a pending request to — a "Follow" button on someone you already asked to
 * follow reads as broken.
 */
export interface SuggestedProfile extends UserProfile {
  ratingCount: number;
  followerCount: number;
  /** 0..1 taste-quiz + home-base similarity to the viewer — see
   *  lib/suggestions.ts#tasteMatchScore. */
  matchScore: number;
  /** Human-readable reason for the match ("Also loves Italian"), or null
   *  when there's no shared signal to point to. */
  matchReason: string | null;
  /** In the viewer's address book, per a contact sync the caller ran. */
  contactMatch?: boolean;
  /** Their name as saved in the viewer's contacts — often the name the
   *  viewer actually recognises. Feeds suggestionSubtitle's top line. */
  contactName?: string | null;
  /** Graph signals from get_social_suggestions (080). Absent — not 0 —
   *  when the migration isn't applied, so old behavior is preserved. */
  followsYou?: boolean;
  mutualCount?: number;
  coRatedCount?: number;
  coRatedAgreement?: number;
}

/** Pulls the taste-quiz + home-base signal off a profile row for matching.
 *  `taste_profile` is stored as loosely-typed jsonb (lib/taste-quiz.ts), so
 *  this reads defensively rather than trusting its shape. */
function tasteSignalFromProfile(p: {
  taste_profile?: unknown;
  home_city?: string | null;
  home_lat?: number | null;
  home_lng?: number | null;
} | null | undefined): TasteSignal {
  const tp = (p?.taste_profile && typeof p.taste_profile === 'object' && !Array.isArray(p.taste_profile))
    ? p.taste_profile as Record<string, unknown>
    : {};
  return {
    cuisines: Array.isArray(tp.cuisines) ? tp.cuisines.filter((c): c is string => typeof c === 'string') : undefined,
    pricePrimary: typeof tp.pricePrimary === 'number' ? tp.pricePrimary : undefined,
    homeCity: p?.home_city ?? null,
    homeLat: p?.home_lat ?? null,
    homeLng: p?.home_lng ?? null,
  };
}

/** How many public profiles to rank before slicing. Bounded so the stats
 *  RPC stays one cheap call as the platform grows. */
const SUGGESTION_POOL = 60;

export async function getSuggestedProfiles(opts: {
  viewerId: string | null;
  /** Extra ids to leave out (e.g. people already shown elsewhere on screen). */
  excludeUserIds?: string[];
  limit?: number;
  /** User ids known to be in the viewer's address book, from a contact
   *  sync the CALLER already ran (lib/supabase-contacts.ts). An input
   *  rather than fetched here because matching needs the contacts
   *  permission and hashes the whole address book — far too heavy to run
   *  on every rail load. These are user ids, not contact data. */
  contactUserIds?: string[];
}): Promise<SuggestedProfile[]> {
  if (!supabaseConfigured) return [];
  const { viewerId } = opts;
  const limit = opts.limit ?? 10;
  try {
    const exclude = new Set<string>(opts.excludeUserIds ?? []);
    if (viewerId) {
      exclude.add(viewerId);
      // Every edge the viewer OWNS — accepted (already following) and
      // pending (already asked) alike. RLS exposes the caller's own rows,
      // so this needs no elevated read.
      const { data: edges } = await supabase.from('user_friends')
        .select('friend_id').eq('user_id', viewerId);
      for (const e of (edges || []) as Array<{ friend_id: unknown }>) {
        exclude.add(String(e.friend_id));
      }
    }

    /* ── Three candidate sources, merged ─────────────────────────────
       1. The social graph (get_social_suggestions, migration 080) —
          friends-of-friends and people who follow the viewer, with
          mutual/co-rating counts the client can't compute itself.
       2. The public-profile pool — backfill so a viewer with a thin (or
          no) graph still gets a full rail; also today's whole behavior,
          which is exactly what this degrades to.
       The graph RPC failing (most likely: migration not applied) warns
       and falls through — same convention as getFollowListIds. */
    type SocialRow = {
      user_id: string; mutual_count: number; follows_you: boolean;
      co_rated_count: number; co_rated_agreement: number;
    };
    // Promise.resolve wraps the builder's PromiseLike into a real Promise.
    const socialPromise: Promise<SocialRow[]> = viewerId
      ? Promise.resolve(supabase.rpc('get_social_suggestions', { p_limit: SUGGESTION_POOL }))
        .then(({ data, error }) => {
          if (error) {
            console.warn('get_social_suggestions unavailable, using public pool only:', error.message);
            return [] as SocialRow[];
          }
          return (data ?? []) as SocialRow[];
        })
      : Promise.resolve([]);

    let q = supabase.from('user_profiles').select('*').eq('is_public', true).limit(SUGGESTION_POOL);
    if (exclude.size > 0) {
      // Same manual formatting as getProfilesInArea — the JS builder won't
      // take an array for `not(..., 'in', ...)`.
      q = q.not('user_id', 'in', `(${[...exclude].map((id) => `"${id}"`).join(',')})`);
    }
    const [socialRows, poolResult] = await Promise.all([socialPromise, q]);
    const social = new Map(socialRows.map((r) => [r.user_id, r]));

    const pool = ((poolResult.data ?? []) as UserProfile[]).filter((p) => !exclude.has(p.user_id));
    // Graph candidates the pool didn't return: private accounts (a
    // request is a fine suggestion when you likely know them) and anyone
    // past the pool's row limit. One batched fetch resolves them.
    const contactIds = new Set(opts.contactUserIds ?? []);
    const graphAndContactIds = [...new Set([...socialRows.map((r) => r.user_id), ...contactIds])];
    const missingIds = graphAndContactIds
      .filter((id) => !exclude.has(id) && !pool.some((p) => p.user_id === id));
    const extraProfiles = await getProfilesByIds(missingIds);
    const profiles = [...pool, ...missingIds.map((id) => extraProfiles[id]).filter(Boolean)];
    if (profiles.length === 0) return [];

    // The viewer's own taste-quiz + home-base signal, so candidates can be
    // scored against it — one extra single-row read, not one per candidate.
    const [stats, viewerRow] = await Promise.all([
      getExpertStats(profiles.map((p) => p.user_id)),
      viewerId
        ? supabase.from('user_profiles')
          .select('taste_profile, home_city, home_lat, home_lng')
          .eq('user_id', viewerId)
          .maybeSingle()
          .then((r) => r.data)
        : Promise.resolve(null),
    ]);
    const viewerSignal = tasteSignalFromProfile(viewerRow);

    const scored: SuggestedProfile[] = profiles.map((p) => {
      const candidateSignal = tasteSignalFromProfile(p);
      const s = social.get(p.user_id);
      return {
        ...p,
        ratingCount: stats[p.user_id]?.ratingCount ?? 0,
        followerCount: stats[p.user_id]?.followerCount ?? 0,
        matchScore: tasteMatchScore(viewerSignal, candidateSignal),
        matchReason: tasteMatchReason(viewerSignal, candidateSignal),
        ...(contactIds.has(p.user_id) ? { contactMatch: true } : {}),
        ...(s ? {
          followsYou: s.follows_you,
          mutualCount: s.mutual_count,
          coRatedCount: s.co_rated_count,
          coRatedAgreement: s.co_rated_agreement,
        } : {}),
      };
    });
    // Ordering and the reason line live in lib/suggestions so they can be
    // tested without a Supabase mock. Rank over the whole merged pool,
    // then cap any one reason category at half the rail — a heavy contact
    // sync or one very connected friend must not fill it entirely.
    const ranked = rankSuggestedProfiles(scored, scored.length);
    return diversifySuggestions(ranked, limit);
  } catch { return []; }
}

export async function searchUsersByUsername(query: string, currentUserId: string): Promise<UserProfile[]> {
  if (!supabaseConfigured) return [];
  try {
    let q = supabase.from('user_profiles').select('*').neq('user_id', currentUserId).limit(20);
    if (query.trim()) {
      const escaped = query.trim().replace(/[%_\\]/g, '\\$&');
      q = q.or(`username.ilike.%${escaped}%,display_name.ilike.%${escaped}%`);
    }
    const { data, error } = await q;
    if (error) return [];
    return (data || []) as UserProfile[];
  } catch { return []; }
}

export async function getProfilesByIds(userIds: string[]): Promise<Record<string, UserProfile>> {
  if (!supabaseConfigured || userIds.length === 0) return {};
  try {
    const { data, error } = await supabase.from('user_profiles')
      .select('*').in('user_id', userIds);
    if (error) return {};
    const map: Record<string, UserProfile> = {};
    (data || []).forEach((p: any) => { map[p.user_id] = p as UserProfile; });
    return map;
  } catch { return {}; }
}

/** Check if currentUser can view targetUser's profile */
export async function canViewProfile(currentUserId: string, targetProfile: UserProfile): Promise<boolean> {
  if (targetProfile.is_public) return true;
  if (currentUserId === targetProfile.user_id) return true;
  // Check mutual friendship
  if (!supabaseConfigured) return false;
  try {
    const { data } = await supabase.from('user_friends')
      .select('id').eq('user_id', currentUserId).eq('friend_id', targetProfile.user_id).eq('status', 'accepted').single();
    return !!data;
  } catch { return false; }
}

/** True when `userId` currently follows `targetId` (accepted edge). */
export async function isFollowingUser(userId: string, targetId: string): Promise<boolean> {
  if (!supabaseConfigured || !userId || !targetId || userId === targetId) return false;
  try {
    const { data } = await supabase.from('user_friends')
      .select('id')
      .eq('user_id', userId)
      .eq('friend_id', targetId)
      .eq('status', 'accepted')
      .maybeSingle();
    return !!data;
  } catch { return false; }
}

export type FollowState = 'none' | 'pending' | 'accepted';
export interface FriendshipStatus {
  /** My edge toward them (user_id=me, friend_id=them). */
  iFollow: FollowState;
  /** Their edge toward me (user_id=them, friend_id=me). */
  theyFollow: FollowState;
}

/**
 * Full directional relationship between `userId` (me) and `targetId` (them),
 * read in a single query. Drives the Follow / Following / Requested /
 * Follow-back button states:
 *   - iFollow='accepted'                    → Following
 *   - iFollow='pending'                     → Requested
 *   - iFollow='none' && theyFollow='accepted' → Follow back
 *   - both 'none'                           → Follow
 * Mutual friends = iFollow==='accepted' && theyFollow==='accepted'.
 */
export async function getFriendshipStatus(userId: string, targetId: string): Promise<FriendshipStatus> {
  const none: FriendshipStatus = { iFollow: 'none', theyFollow: 'none' };
  if (!supabaseConfigured || !userId || !targetId || userId === targetId) return none;
  try {
    const { data, error } = await supabase.from('user_friends')
      .select('user_id, friend_id, status')
      .or(`and(user_id.eq.${userId},friend_id.eq.${targetId}),and(user_id.eq.${targetId},friend_id.eq.${userId})`);
    if (error) { console.error('[Friends] getFriendshipStatus error:', error); return none; }
    let iFollow: FollowState = 'none';
    let theyFollow: FollowState = 'none';
    for (const row of (data || []) as Array<{ user_id: string; friend_id: string; status: string }>) {
      const st: FollowState = row.status === 'accepted' ? 'accepted' : row.status === 'pending' ? 'pending' : 'none';
      if (st === 'none') continue;
      if (row.user_id === userId && row.friend_id === targetId) iFollow = st;
      else if (row.user_id === targetId && row.friend_id === userId) theyFollow = st;
    }
    return { iFollow, theyFollow };
  } catch (err) { console.error('[Friends] getFriendshipStatus exception:', err); return none; }
}

/** IDs of mutual friends — users you follow who also follow you back. */
export async function getMutualFriendIds(userId: string): Promise<string[]> {
  if (!supabaseConfigured || !userId) return [];
  const [following, followers] = await Promise.all([getFriends(userId), getFollowerIds(userId)]);
  const followerSet = new Set(followers);
  return following.filter((f) => followerSet.has(f.friend_id)).map((f) => f.friend_id);
}

/** Follow a public account instantly (no request needed) */
export async function followPublicAccount(userId: string, targetId: string): Promise<boolean> {
  if (!supabaseConfigured || !userId || !targetId || userId === targetId) return false;
  try {
    const { error } = await supabase.from('user_friends')
      .upsert({ user_id: userId, friend_id: targetId, status: 'accepted' }, { onConflict: 'user_id,friend_id' });
    if (error) { console.error('[Friends] followPublic error:', error); return false; }
    return true;
  } catch (err) { console.error('[Friends] followPublic exception:', err); return false; }
}

/** Get follower and following counts.
 *
 *  Goes through the SECURITY DEFINER RPC from migration 052: the
 *  user_friends SELECT policy only exposes rows involving the CALLER and
 *  RLS filters before counting, so direct count queries returned 0-or-1
 *  for everyone else's profile (and ~0 for every expert). The RPC counts
 *  server-side and returns only the aggregates. */
export async function getFollowCounts(userId: string): Promise<{ followers: number; following: number }> {
  if (!supabaseConfigured || !userId) return { followers: 0, following: 0 };
  try {
    const { data, error } = await supabase.rpc('get_follow_counts', { target: userId });
    if (!error && data) {
      const row = (Array.isArray(data) ? data[0] : data) as { followers?: unknown; following?: unknown } | undefined;
      if (row) return { followers: Number(row.followers) || 0, following: Number(row.following) || 0 };
    }
    if (error) console.warn('[Community] get_follow_counts RPC failed (migration 052 applied?) — falling back to RLS-limited counts:', error.message);
    // Fallback for projects without migration 052 — only accurate for the
    // caller's own id (RLS hides everyone else's edges).
    const [{ count: following }, { count: followers }] = await Promise.all([
      supabase.from('user_friends').select('*', { count: 'exact', head: true }).eq('user_id', userId).eq('status', 'accepted'),
      supabase.from('user_friends').select('*', { count: 'exact', head: true }).eq('friend_id', userId).eq('status', 'accepted'),
    ]);
    return { followers: followers || 0, following: following || 0 };
  } catch { return { followers: 0, following: 0 }; }
}

export interface ExpertStats { ratingCount: number; followerCount: number }

/**
 * Rating + follower counts for a batch of users in ONE round-trip (RPC from
 * migration 056). The old path was 3 requests PER expert: an unbounded
 * `select *` just to read `.length`, plus get_follow_counts. Falls back to
 * bounded head-count queries when the migration isn't applied.
 */
export async function getExpertStats(userIds: string[]): Promise<Record<string, ExpertStats>> {
  const out: Record<string, ExpertStats> = {};
  const ids = Array.from(new Set(userIds.filter(Boolean)));
  if (!supabaseConfigured || ids.length === 0) return out;
  try {
    const { data, error } = await supabase.rpc('get_expert_stats', { user_ids: ids });
    if (!error && data) {
      for (const row of data as Array<{ user_id: string; rating_count: unknown; follower_count: unknown }>) {
        out[row.user_id] = {
          ratingCount: Number(row.rating_count) || 0,
          followerCount: Number(row.follower_count) || 0,
        };
      }
      return out;
    }
    if (error) console.warn('[Community] get_expert_stats RPC failed (migration 056 applied?) — falling back to per-user counts:', error.message);
    // Fallback: still no `select *` — head-only counts + the follow RPC.
    const results = await Promise.all(ids.map(async (id) => {
      const [{ count }, counts] = await Promise.all([
        supabase.from('community_ratings').select('*', { count: 'exact', head: true }).eq('user_id', id),
        getFollowCounts(id),
      ]);
      return { id, ratingCount: count || 0, followerCount: counts.followers };
    }));
    for (const r of results) out[r.id] = { ratingCount: r.ratingCount, followerCount: r.followerCount };
    return out;
  } catch { return out; }
}

/** Get all ratings by a specific user */
export async function getUserRatings(userId: string): Promise<CommunityRating[]> {
  if (!supabaseConfigured || !userId) return [];
  try {
    const { data, error } = await supabase.from('community_ratings')
      .select('*').eq('user_id', userId).order('updated_at', { ascending: false });
    if (error) return [];
    return (data || []) as CommunityRating[];
  } catch { return []; }
}

/**
 * The id of a user's own rating row for one restaurant, if it exists.
 * Likes and comments hang off `community_ratings.id`, but the app tracks
 * ratings locally by restaurantId — this is the bridge that lets a
 * restaurant page ask "what did people say about MY rating of this
 * place?" without pulling the user's entire rating history.
 */
export async function getOwnRatingId(userId: string, restaurantId: string): Promise<string | null> {
  if (!supabaseConfigured || !userId || !restaurantId) return null;
  try {
    const { data, error } = await supabase.from('community_ratings')
      .select('id').eq('user_id', userId).eq('restaurant_id', restaurantId).maybeSingle();
    if (error || !data) return null;
    return (data as { id: string }).id;
  } catch { return null; }
}

/** Get all photos by a specific user */
export async function getUserPhotos(userId: string): Promise<CommunityPhoto[]> {
  if (!supabaseConfigured || !userId) return [];
  try {
    const { data, error } = await supabase.from('community_photos')
      .select('*').eq('user_id', userId).order('created_at', { ascending: false });
    if (error) return [];
    return (data || []) as CommunityPhoto[];
  } catch { return []; }
}

/** Get a user's wishlist items.
 *
 *  user_app_data is owner-only under RLS (migration 013); cross-user reads
 *  go through the SECURITY DEFINER RPCs from migration 036, which return
 *  only public-safe fields and nothing at all when the target profile is
 *  private and the caller isn't an accepted follower. */
export async function getUserWishlist(userId: string): Promise<{ restaurantId: string; name: string; cuisine: string; price: string; address: string; notes: string }[]> {
  if (!supabaseConfigured || !userId) return [];
  try {
    const { data, error } = await supabase.rpc('get_public_wishlist', { target: userId });
    if (error || !Array.isArray(data)) return [];
    return (data as any[]).map((w: any) => ({
      restaurantId: w.restaurantId, name: w.name, cuisine: w.cuisine || '',
      price: w.price || '', address: w.address || '', notes: w.notes || '',
    }));
  } catch { return []; }
}

/** Get a user's lists (includes wishlist as first item). Same RPC-backed
 *  visibility rules as getUserWishlist. */
export async function getUserLists(userId: string): Promise<{ id: string; name: string; emoji: string; restaurantIds: string[] }[]> {
  if (!supabaseConfigured || !userId) return [];
  try {
    const [listsRes, wishRes] = await Promise.all([
      supabase.rpc('get_public_lists', { target: userId }),
      supabase.rpc('get_public_wishlist', { target: userId }),
    ]);
    if (listsRes.error && wishRes.error) return [];

    const result: { id: string; name: string; emoji: string; restaurantIds: string[] }[] = [];

    // Wishlist always first
    const wishlistItems = (!wishRes.error && Array.isArray(wishRes.data)) ? (wishRes.data as any[]) : [];
    if (wishlistItems.length > 0) {
      result.push({ id: '__wishlist__', name: 'Wishlist', emoji: '🔖', restaurantIds: wishlistItems.map((w: any) => w.restaurantId) });
    }

    // Then regular lists
    const lists = (!listsRes.error && Array.isArray(listsRes.data)) ? (listsRes.data as any[]) : [];
    lists.forEach((l: any) => {
      result.push({ id: l.id, name: l.name, emoji: l.emoji, restaurantIds: l.restaurantIds || [] });
    });

    return result;
  } catch { return []; }
}

/** Get ratings from experts (users with is_expert=true) */
export async function getExpertRatings(limit = 50): Promise<CommunityRating[]> {
  if (!supabaseConfigured) return [];
  try {
    // Get expert user IDs
    const { data: experts } = await supabase.from('user_profiles').select('user_id').eq('is_verified', true);
    if (!experts || experts.length === 0) return [];
    const expertIds = experts.map((e: any) => e.user_id);
    const { data, error } = await supabase.from('community_ratings')
      .select('*').in('user_id', expertIds).order('updated_at', { ascending: false }).limit(limit);
    if (error) return [];
    return (data || []) as CommunityRating[];
  } catch { return []; }
}

/**
 * Every community rating authored by any user in `userIds`. Unlike
 * `getExpertRatings` this has no recency cap — the global top-N
 * ordering cuts off ratings for smaller cities, so the /location
 * "Experts only" filter uses this to get the full set of ratings
 * from the specific experts the user follows.
 */
export async function getRatingsByUserIds(userIds: string[]): Promise<CommunityRating[]> {
  if (!supabaseConfigured || userIds.length === 0) return [];
  try {
    const { data, error } = await supabase
      .from('community_ratings')
      .select('*')
      .in('user_id', userIds);
    if (error) return [];
    return (data || []) as CommunityRating[];
  } catch { return []; }
}

/** Get all ratings from user's friends (for friends map), excluding experts */
export async function getAllFriendRatings(userId: string): Promise<CommunityRating[]> {
  if (!supabaseConfigured || !userId) return [];
  try {
    const friends = await getFriends(userId);
    if (friends.length === 0) return [];
    const friendIds = friends.map((f) => f.friend_id);

    // Exclude expert users so their ratings only appear in the experts tab
    const { data: experts } = await supabase.from('user_profiles').select('user_id').eq('is_verified', true);
    const expertIds = new Set((experts || []).map((e: any) => e.user_id));
    const nonExpertFriendIds = friendIds.filter((id) => !expertIds.has(id));
    if (nonExpertFriendIds.length === 0) return [];

    const { data, error } = await supabase.from('community_ratings')
      .select('*').in('user_id', nonExpertFriendIds).order('updated_at', { ascending: false });
    if (error) return [];
    return (data || []) as CommunityRating[];
  } catch { return []; }
}

/** Get ratings from everyone the user follows — friends AND experts.
 *  The Following feed uses this so followed experts aren't hidden. */
export async function getAllFollowedRatings(userId: string): Promise<CommunityRating[]> {
  if (!supabaseConfigured || !userId) return [];
  try {
    const friends = await getFriends(userId);
    if (friends.length === 0) return [];
    const ids = friends.map((f) => f.friend_id);
    const { data, error } = await supabase.from('community_ratings')
      .select('*').in('user_id', ids).order('updated_at', { ascending: false });
    if (error) { console.error('[Community] getAllFollowedRatings error:', error); return []; }
    return (data || []) as CommunityRating[];
  } catch (err) { console.error('[Community] getAllFollowedRatings exception:', err); return []; }
}

/* ── Likes & Comments ── */

export interface ActivityComment {
  id: string;
  user_id: string;
  rating_id: string;
  text: string;
  created_at: string;
  /** Null = top-level comment. Set = reply to that comment. One level
   *  of nesting only — replies to replies still attach to the same
   *  parent (YouTube-style). */
  parent_id?: string | null;
  /** Aggregated count of comment likes; populated by getComments. */
  like_count?: number;
  /** True iff the current user has liked this comment. */
  liked_by_me?: boolean;
  profile?: UserProfile;
}

export interface ToggleLikeResult {
  ok: boolean;
  /** The state the like is actually in server-side after this call (best
   *  known state on failure). Callers reconcile their optimistic UI to it. */
  liked: boolean;
}

/** Select-then-write toggle. Each write's { error } is checked explicitly —
 *  supabase-js does NOT throw for RLS/constraint failures, so the old
 *  version returned true even when the write silently failed, which made
 *  every caller's rollback dead code and let fast double-taps drift the
 *  heart from server state. */
export async function toggleLike(userId: string, ratingId: string): Promise<ToggleLikeResult> {
  if (!supabaseConfigured || !userId) return { ok: false, liked: false };
  try {
    const { data, error: selectError } = await supabase.from('activity_likes')
      .select('id').eq('user_id', userId).eq('rating_id', ratingId).maybeSingle();
    if (selectError) {
      console.warn('[Community] toggleLike select failed:', selectError.message);
      return { ok: false, liked: false };
    }
    if (data) {
      const { error } = await supabase.from('activity_likes').delete().eq('id', data.id);
      if (error) {
        console.warn('[Community] toggleLike delete failed:', error.message);
        return { ok: false, liked: true }; // row survived — still liked
      }
      return { ok: true, liked: false };
    }
    const { error } = await supabase.from('activity_likes').insert({ user_id: userId, rating_id: ratingId });
    if (error) {
      // 23505: a concurrent insert (double-tap racing this one) already
      // created the row — the like exists, which is what we wanted.
      if (error.code === '23505') return { ok: true, liked: true };
      console.warn('[Community] toggleLike insert failed:', error.message);
      return { ok: false, liked: false };
    }
    return { ok: true, liked: true };
  } catch { return { ok: false, liked: false }; }
}

export async function getLikeCount(ratingId: string): Promise<number> {
  if (!supabaseConfigured) return 0;
  try {
    const { count } = await supabase.from('activity_likes')
      .select('*', { count: 'exact', head: true }).eq('rating_id', ratingId);
    return count || 0;
  } catch { return 0; }
}

export async function isLikedByUser(userId: string, ratingId: string): Promise<boolean> {
  if (!supabaseConfigured || !userId) return false;
  try {
    const { data } = await supabase.from('activity_likes')
      .select('id').eq('user_id', userId).eq('rating_id', ratingId).single();
    return !!data;
  } catch { return false; }
}

export async function getLikesForRatings(userId: string, ratingIds: string[]): Promise<{ likes: Record<string, number>; userLiked: Set<string> }> {
  if (!supabaseConfigured || ratingIds.length === 0) return { likes: {}, userLiked: new Set() };
  try {
    const { data } = await supabase.from('activity_likes')
      .select('rating_id, user_id').in('rating_id', ratingIds);
    const likes: Record<string, number> = {};
    const userLiked = new Set<string>();
    (data || []).forEach((l: any) => {
      likes[l.rating_id] = (likes[l.rating_id] || 0) + 1;
      if (l.user_id === userId) userLiked.add(l.rating_id);
    });
    return { likes, userLiked };
  } catch { return { likes: {}, userLiked: new Set() }; }
}

export async function addComment(
  userId: string,
  ratingId: string,
  text: string,
  parentId: string | null = null,
): Promise<boolean> {
  if (!supabaseConfigured || !userId || !text.trim()) return false;
  try {
    const payload: Record<string, unknown> = {
      user_id: userId,
      rating_id: ratingId,
      text: text.trim(),
    };
    if (parentId) payload.parent_id = parentId;
    const { error } = await supabase.from('activity_comments').insert(payload);
    return !error;
  } catch { return false; }
}

/**
 * Fetches every comment for a rating (top-level + replies) plus per-comment
 * like counts and whether the calling user liked each one. Replies are
 * identified by their `parent_id`; the caller is responsible for grouping
 * them under their parents in the UI.
 *
 * Falls back gracefully if the migration adding parent_id /
 * activity_comment_likes hasn't been applied — comments still render, just
 * without like counts or replies.
 */
export async function getComments(ratingId: string, currentUserId?: string | null): Promise<ActivityComment[]> {
  if (!supabaseConfigured) return [];
  try {
    const { data, error } = await supabase.from('activity_comments')
      .select('*').eq('rating_id', ratingId).order('created_at', { ascending: true });
    if (error) return [];
    const comments = (data || []) as ActivityComment[];
    if (comments.length === 0) return comments;

    // Pull all likes for these comments in one shot, then fold into each row.
    const ids = comments.map((c) => c.id);
    try {
      const { data: likeRows } = await supabase.from('activity_comment_likes')
        .select('comment_id, user_id').in('comment_id', ids);
      const counts: Record<string, number> = {};
      const mine = new Set<string>();
      (likeRows || []).forEach((row: { comment_id: string; user_id: string }) => {
        counts[row.comment_id] = (counts[row.comment_id] || 0) + 1;
        if (currentUserId && row.user_id === currentUserId) mine.add(row.comment_id);
      });
      return comments.map((c) => ({
        ...c,
        like_count: counts[c.id] || 0,
        liked_by_me: mine.has(c.id),
      }));
    } catch {
      // Likes table not available yet — return comments without like info.
      return comments;
    }
  } catch { return []; }
}

/**
 * Toggle the calling user's like on a single comment. Returns the new
 * liked state (true if it ended up liked).
 */
export async function toggleCommentLike(userId: string, commentId: string): Promise<boolean | null> {
  if (!supabaseConfigured || !userId) return null;
  try {
    const { data } = await supabase.from('activity_comment_likes')
      .select('id').eq('user_id', userId).eq('comment_id', commentId).single();
    if (data) {
      await supabase.from('activity_comment_likes').delete().eq('id', data.id);
      return false;
    }
    await supabase.from('activity_comment_likes').insert({ user_id: userId, comment_id: commentId });
    return true;
  } catch { return null; }
}

export async function getCommentCounts(ratingIds: string[]): Promise<Record<string, number>> {
  if (!supabaseConfigured || ratingIds.length === 0) return {};
  try {
    const { data } = await supabase.from('activity_comments')
      .select('rating_id').in('rating_id', ratingIds);
    const counts: Record<string, number> = {};
    (data || []).forEach((c: any) => { counts[c.rating_id] = (counts[c.rating_id] || 0) + 1; });
    return counts;
  } catch { return {}; }
}

export interface FriendInfo {
  friend_id: string;
  status: string; // 'pending' | 'accepted'
}

export interface FriendRequest {
  id: string;
  user_id: string;
  friend_id: string;
  status: string;
  created_at: string;
  profile?: UserProfile;
}

/** Get accepted friends */
export async function getFriends(userId: string): Promise<FriendInfo[]> {
  if (!supabaseConfigured || !userId) return [];
  try {
    const { data, error } = await supabase.from('user_friends')
      .select('friend_id, status').eq('user_id', userId).eq('status', 'accepted');
    if (error) { console.error('[Friends] getFriends error:', error); return []; }
    return (data || []) as FriendInfo[];
  } catch (err) { console.error('[Friends] getFriends exception:', err); return []; }
}

/**
 * IDs of every user who follows the given userId — i.e. the "followers"
 * side of the user_friends edge. Mirrors getFriends but flipped: we look
 * up accepted rows where friend_id = userId and return the user_ids of
 * the rows.
 */
export async function getFollowerIds(userId: string): Promise<string[]> {
  if (!supabaseConfigured || !userId) return [];
  try {
    const { data, error } = await supabase.from('user_friends')
      .select('user_id').eq('friend_id', userId).eq('status', 'accepted');
    if (error) { console.error('[Friends] getFollowerIds error:', error); return []; }
    return (data || []).map((r) => (r as { user_id: string }).user_id);
  } catch (err) { console.error('[Friends] getFollowerIds exception:', err); return []; }
}

/**
 * Ordered user ids on one side of a target's follow graph (newest edge
 * first). Goes through the SECURITY DEFINER RPC from migration 062: the
 * user_friends SELECT policy only exposes rows involving the CALLER, so a
 * direct query can't list anyone else's followers/following. The RPC
 * applies the same visibility rule as the other profile-data RPCs — the
 * target is public, the caller IS the target, or the caller has an
 * accepted follow edge to the target — and returns [] otherwise.
 * Falls back to the RLS-limited direct queries (accurate only for the
 * caller's own id) when the migration isn't applied.
 */
export async function getFollowListIds(
  targetId: string,
  direction: 'followers' | 'following',
): Promise<string[]> {
  if (!supabaseConfigured || !targetId) return [];
  try {
    const { data, error } = await supabase.rpc('get_follow_list', { target: targetId, direction });
    if (!error && Array.isArray(data)) {
      return (data as Array<{ other_user_id: string }>).map((r) => r.other_user_id).filter(Boolean);
    }
    if (error) console.warn('[Community] get_follow_list RPC failed (migration 062 applied?) — falling back to RLS-limited list:', error.message);
    return direction === 'followers'
      ? await getFollowerIds(targetId)
      : (await getFriends(targetId)).map((f) => f.friend_id);
  } catch { return []; }
}

/** Get pending friend requests sent TO you */
export async function getPendingRequests(userId: string): Promise<FriendRequest[]> {
  if (!supabaseConfigured || !userId) return [];
  try {
    const { data, error } = await supabase.from('user_friends')
      .select('id, user_id, friend_id, status, created_at')
      .eq('friend_id', userId).eq('status', 'pending')
      .order('created_at', { ascending: false });
    if (error) { console.error('[Friends] getPendingRequests error:', error); return []; }
    return (data || []) as FriendRequest[];
  } catch (err) { console.error('[Friends] getPendingRequests exception:', err); return []; }
}

/** IDs of users the given user has SENT a still-pending friend request to
 *  (the outgoing side: rows where user_id = me and status = 'pending').
 *  Used by the Add-a-friend sheet to show "Requested" instead of an "Add"
 *  button that would violate the unique(user_id, friend_id) constraint. */
export async function getSentRequestIds(userId: string): Promise<string[]> {
  if (!supabaseConfigured || !userId) return [];
  try {
    const { data, error } = await supabase.from('user_friends')
      .select('friend_id').eq('user_id', userId).eq('status', 'pending');
    if (error) { console.error('[Friends] getSentRequestIds error:', error); return []; }
    return (data || []).map((r) => (r as { friend_id: string }).friend_id);
  } catch (err) { console.error('[Friends] getSentRequestIds exception:', err); return []; }
}

/** Send a friend request (status = 'pending').
 *
 *  UPSERT, not INSERT: a declined request leaves its row in place under
 *  UNIQUE(user_id, friend_id), so a plain insert hit 23505 forever once
 *  the target had declined — every retry showed "Couldn't send that
 *  request." The upsert flips the surviving row back to 'pending'
 *  (requester-side UPDATE policy from migration 053). An existing
 *  'accepted' edge is left alone so an errant call can't downgrade an
 *  established follow back to pending. */
export async function sendFriendRequest(userId: string, friendId: string): Promise<boolean> {
  if (!supabaseConfigured || !userId || !friendId || userId === friendId) return false;
  try {
    const { data: existing } = await supabase.from('user_friends')
      .select('status').eq('user_id', userId).eq('friend_id', friendId).maybeSingle();
    if ((existing as { status?: string } | null)?.status === 'accepted') return true; // already following
    const { error } = await supabase.from('user_friends')
      .upsert({ user_id: userId, friend_id: friendId, status: 'pending' }, { onConflict: 'user_id,friend_id' });
    if (error) { console.error('[Friends] sendRequest error:', error); return false; }
    return true;
  } catch (err) { console.error('[Friends] sendRequest exception:', err); return false; }
}

/**
 * Accept an incoming follow request. This is ONE-DIRECTIONAL (Instagram-style):
 * it only marks the requester's edge `accepted` — they now follow you. It does
 * NOT make you follow them back. Becoming mutual friends requires you to follow
 * them back separately (which they must accept if their account is private).
 *
 * RLS permits this UPDATE because you're the `friend_id` on the row
 * ("Users can update incoming requests" → `auth.uid() = friend_id`).
 */
export async function acceptFriendRequest(requestId: string): Promise<boolean> {
  if (!supabaseConfigured) return false;
  try {
    const { error } = await supabase.from('user_friends')
      .update({ status: 'accepted' }).eq('id', requestId);
    if (error) { console.error('[Friends] accept error:', error); return false; }
    return true;
  } catch (err) { console.error('[Friends] accept exception:', err); return false; }
}

/**
 * Decline a friend request. We UPDATE the row to status='declined' rather
 * than DELETE it: the table's RLS only lets the request's SENDER delete a
 * row (`auth.uid() = user_id`), but the person declining is the RECIPIENT
 * (`auth.uid() = friend_id`). The UPDATE policy *does* allow the recipient
 * to change the row, and getPendingRequests filters to status='pending',
 * so a declined request drops out of the incoming list and stops counting
 * toward the badge. A DELETE here silently affected zero rows.
 */
export async function declineFriendRequest(requestId: string): Promise<boolean> {
  if (!supabaseConfigured) return false;
  try {
    const { error } = await supabase.from('user_friends')
      .update({ status: 'declined' }).eq('id', requestId);
    if (error) { console.error('[Friends] decline error:', error); return false; }
    return true;
  } catch (err) { console.error('[Friends] decline exception:', err); return false; }
}

/** Add a friend by their user ID (legacy - now sends request) */
export async function addFriend(userId: string, friendId: string): Promise<boolean> {
  return sendFriendRequest(userId, friendId);
}

/**
 * Unfollow: remove MY outgoing edge to `friendId` (I stop following them).
 * The graph is directional (see the follow-friend model), so this is
 * deliberately one-directional — it must NOT touch `friendId→userId` (their
 * follow of me is their edge; unfollowing someone can't silently strip them
 * of me as a follower). To revoke a follower's access, use removeFollower.
 * RLS: permitted by the `user_id` DELETE policy (migration 002).
 */
export async function removeFriend(userId: string, friendId: string): Promise<boolean> {
  if (!supabaseConfigured || !userId) return false;
  try {
    const { error } = await supabase.from('user_friends')
      .delete().eq('user_id', userId).eq('friend_id', friendId);
    if (error) { console.error('[Friends] removeFriend error:', error); return false; }
    return true;
  } catch (err) { console.error('[Friends] removeFriend exception:', err); return false; }
}

/**
 * Remove a FOLLOWER: delete the `followerId→userId` edge so `followerId` no
 * longer follows `userId`. This is how a (private) account revokes an approved
 * follower's access — after this they fail canViewProfile for the private
 * account and their activity feed drops the ex-followee. Requires the
 * `friend_id` DELETE policy (migration 040): the row is owned by the follower
 * as `user_id`, and `userId` is the `friend_id` side.
 */
export async function removeFollower(userId: string, followerId: string): Promise<boolean> {
  if (!supabaseConfigured || !userId || !followerId) return false;
  try {
    const { error } = await supabase.from('user_friends')
      .delete().eq('user_id', followerId).eq('friend_id', userId);
    if (error) { console.error('[Friends] removeFollower error:', error); return false; }
    return true;
  } catch (err) { console.error('[Friends] removeFollower exception:', err); return false; }
}

/** Search users by email (for adding friends) */
export async function searchUsers(query: string): Promise<{ id: string; email: string }[]> {
  if (!supabaseConfigured || !query.trim()) return [];
  try {
    // Query the auth.users view via a community_ratings lookup (since we can't directly query auth.users)
    // Instead, search community_ratings for distinct user_ids and match
    const { data, error } = await supabase.from('community_ratings')
      .select('user_id')
      .limit(50);
    if (error || !data) return [];
    // Return unique user IDs as potential friends
    const seen = new Set<string>();
    return data.filter((d: any) => {
      if (seen.has(d.user_id)) return false;
      seen.add(d.user_id);
      return true;
    }).map((d: any) => ({ id: d.user_id, email: d.user_id.slice(0, 8) + '...' }));
  } catch (err) { console.error('[Friends] searchUsers exception:', err); return []; }
}

/** Get a friend's recent ratings (for activity feed) */
export async function getFriendActivity(friendIds: string[], limit = 20): Promise<CommunityRating[]> {
  if (!supabaseConfigured || friendIds.length === 0) return [];
  try {
    const { data, error } = await supabase.from('community_ratings')
      .select('*').in('user_id', friendIds)
      .order('updated_at', { ascending: false }).limit(limit);
    if (error) { console.error('[Friends] getActivity error:', error); return []; }
    return (data || []) as CommunityRating[];
  } catch (err) { console.error('[Friends] getActivity exception:', err); return []; }
}

/** Fetch public home meals from a list of friend user IDs. */
export interface FriendHomeMeal extends HomeMeal {
  userId: string;
}

// Home meals are read through the SECURITY DEFINER RPCs from migration 036:
// user_app_data is owner-only under RLS (013), and the RPCs return only
// meals with isPublic=true from users the caller may view (public profile,
// self, or accepted follow edge). Merging of the dedicated home_meals
// column with the restaurant_meta.__home_meals__ fallback and the
// __deleted_meals__ tombstones now happens server-side.

export async function getFriendsPublicHomeMeals(friendIds: string[]): Promise<FriendHomeMeal[]> {
  if (!supabaseConfigured || friendIds.length === 0) return [];
  try {
    const { data, error } = await supabase.rpc('get_friends_public_home_meals', { friend_ids: friendIds });
    if (error) { console.warn('[Friends] getPublicHomeMeals error:', error.message); return []; }
    const result: FriendHomeMeal[] = [];
    for (const row of (data || []) as Array<{ user_id: string; meal: HomeMeal }>) {
      if (row.meal && row.meal.id) result.push({ ...row.meal, userId: row.user_id });
    }
    result.sort((a, b) => b.createdAt - a.createdAt);
    return result;
  } catch (err) { console.error('[Friends] getPublicHomeMeals exception:', err); return []; }
}

/** Fetch a single user's public home meal by id. Returns null when the meal
 *  is missing, not marked public, or the owner isn't viewable by the caller. */
export async function getPublicHomeMealById(userId: string, mealId: string): Promise<FriendHomeMeal | null> {
  if (!supabaseConfigured || !userId || !mealId) return null;
  try {
    const meals = await getUserPublicHomeMeals(userId);
    const match = meals.find((m) => m.id === mealId);
    return match ? { ...match, userId } : null;
  } catch (err) {
    console.warn('[Community] getPublicHomeMealById exception:', err);
    return null;
  }
}

/** Fetch public home meals for a single user (for profile view). */
export async function getUserPublicHomeMeals(userId: string): Promise<HomeMeal[]> {
  if (!supabaseConfigured || !userId) return [];
  try {
    const { data, error } = await supabase.rpc('get_public_home_meals', { target: userId });
    if (error || !Array.isArray(data)) return [];
    return (data as HomeMeal[]).filter((m) => m && m.id).sort((a, b) => b.createdAt - a.createdAt);
  } catch (err) { console.error('[Community] getUserPublicHomeMeals exception:', err); return []; }
}

/** Fetch public home meals across the entire platform — every user the
 *  caller may view (public profiles + accepted follows). Used by the AI
 *  assistant's search_community_recipes tool and the Explore recipe
 *  surfaces. Results are deduped by meal id server-side and capped at
 *  `mealLimit`. Excludes the given userId (the asker's own meals are
 *  already in their RECIPES section). `userScanLimit` is obsolete — the
 *  RPC scans set-based — and kept only for call-site compatibility.
 */
export async function getAllPublicHomeMeals(
  excludeUserId: string,
  opts: { userScanLimit?: number; mealLimit?: number } = {},
): Promise<FriendHomeMeal[]> {
  if (!supabaseConfigured) return [];
  const mealLimit = opts.mealLimit ?? 60;
  try {
    const { data, error } = await supabase.rpc('get_all_public_home_meals', {
      exclude_user: excludeUserId || null,
      meal_limit: mealLimit,
    });
    if (error) {
      console.warn('[Community] getAllPublicHomeMeals error:', error.message);
      return [];
    }
    const out: FriendHomeMeal[] = [];
    for (const row of (data || []) as Array<{ user_id: string; meal: HomeMeal }>) {
      if (row.meal && row.meal.id) out.push({ ...row.meal, userId: row.user_id });
    }
    out.sort((a, b) => b.createdAt - a.createdAt);
    return out;
  } catch (err) {
    console.error('[Community] getAllPublicHomeMeals exception:', err);
    return [];
  }
}

/** Community ratings that overlap the user's top tags, scoped to a city if provided. */
export async function getTagSimilarRestaurants(
  myTags: string[],
  city: string | null,
  excludeUserId: string,
  limit = 40,
): Promise<CommunityRating[]> {
  if (!supabaseConfigured || myTags.length === 0) return [];
  try {
    let q = supabase
      .from('community_ratings')
      .select('*')
      .overlaps('tags', myTags)
      .gte('score', 7)
      .order('score', { ascending: false })
      .limit(limit);
    if (excludeUserId) q = q.neq('user_id', excludeUserId);
    if (city) q = q.ilike('address', `%${city.split(',')[0].trim()}%`);
    const { data, error } = await q;
    if (error) { console.warn('[Community] getTagSimilar error:', error.message); return []; }
    // Pure recommendation signal — self-picked slider scores don't feed it.
    return ((data || []) as CommunityRating[]).filter(countsForCommunity);
  } catch (err) { console.warn('[Community] getTagSimilar exception:', err); return []; }
}

/** Intersect the user's follows with users marked is_expert=true. */
export async function getFollowedExpertIds(userId: string): Promise<Set<string>> {
  if (!supabaseConfigured || !userId) return new Set();
  try {
    const friends = await getFriends(userId);
    if (friends.length === 0) return new Set();
    const ids = friends.map((f) => f.friend_id);
    const { data } = await supabase
      .from('user_profiles')
      .select('user_id')
      .in('user_id', ids)
      .eq('is_verified', true);
    return new Set((data || []).map((r: any) => r.user_id));
  } catch { return new Set(); }
}

/* ── Expert Recommendations ── */

export interface ExpertRecommendation {
  id: string;
  user_id: string;
  restaurant_id: string;
  restaurant_name: string;
  cuisine: string;
  price: string;
  address: string;
  photo_url: string;
  recommendation_text: string;
  highlight_dishes: string[];
  rating: number;
  created_at: string;
  updated_at: string;
  // Joined from user_profiles
  expert_name: string;
  expert_username: string;
}

/** Get expert recommendations for a restaurant (joined with profile data). */
export async function getExpertRecommendations(restaurantId: string): Promise<ExpertRecommendation[]> {
  if (!supabaseConfigured || !restaurantId) return [];
  try {
    const { data, error } = await supabase
      .from('expert_recommendations')
      .select('*, user_profiles!expert_recommendations_user_id_fkey(display_name, username)')
      .eq('restaurant_id', restaurantId)
      .order('updated_at', { ascending: false });
    if (error) {
      // Fallback: if join fails (FK not recognized), fetch separately
      console.warn('[Expert] Join failed, falling back to separate queries:', error.message);
      const { data: recs, error: recErr } = await supabase
        .from('expert_recommendations')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .order('updated_at', { ascending: false });
      if (recErr || !recs || recs.length === 0) return [];
      const userIds = [...new Set(recs.map((r: any) => r.user_id))];
      const profiles = await getProfilesByIds(userIds);
      return recs.map((r: any) => ({
        ...r,
        expert_name: profiles[r.user_id]?.display_name || 'Expert',
        expert_username: profiles[r.user_id]?.username || '',
      })) as ExpertRecommendation[];
    }
    return (data || []).map((r: any) => ({
      ...r,
      expert_name: r.user_profiles?.display_name || 'Expert',
      expert_username: r.user_profiles?.username || '',
      user_profiles: undefined,
    })) as ExpertRecommendation[];
  } catch (err) { console.error('[Expert] getRecommendations exception:', err); return []; }
}

/** Publish an expert recommendation for a restaurant. */
export async function publishExpertRecommendation(
  userId: string,
  restaurantId: string,
  data: { name: string; cuisine: string; price: string; address: string; photoUrl: string; text: string; highlightDishes: string[]; rating: number }
): Promise<boolean> {
  if (!supabaseConfigured || !userId) return false;
  try {
    const { error } = await supabase.from('expert_recommendations').upsert({
      user_id: userId,
      restaurant_id: restaurantId,
      restaurant_name: data.name,
      cuisine: data.cuisine,
      price: data.price,
      address: data.address,
      photo_url: data.photoUrl,
      recommendation_text: data.text,
      highlight_dishes: data.highlightDishes,
      rating: data.rating,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,restaurant_id' });
    if (error) { console.error('[Expert] publishRecommendation error:', error); return false; }
    return true;
  } catch (err) { console.error('[Expert] publishRecommendation exception:', err); return false; }
}

/** Get count of expert recommendations by a user. */
export async function getExpertRecommendationCount(userId: string): Promise<number> {
  if (!supabaseConfigured || !userId) return 0;
  try {
    const { count, error } = await supabase.from('expert_recommendations')
      .select('*', { count: 'exact', head: true }).eq('user_id', userId);
    if (error) return 0;
    return count || 0;
  } catch { return 0; }
}

/** Get all expert profiles (users with is_expert=true). */
export async function getExpertProfiles(): Promise<UserProfile[]> {
  if (!supabaseConfigured) return [];
  try {
    const { data, error } = await supabase.from('user_profiles')
      .select('*').eq('is_verified', true);
    if (error) return [];
    return (data || []) as UserProfile[];
  } catch { return []; }
}

/** Remove an expert recommendation. */
export async function removeExpertRecommendation(userId: string, restaurantId: string): Promise<boolean> {
  if (!supabaseConfigured || !userId) return false;
  try {
    const { error } = await supabase.from('expert_recommendations')
      .delete().eq('user_id', userId).eq('restaurant_id', restaurantId);
    if (error) { console.error('[Expert] removeRecommendation error:', error); return false; }
    return true;
  } catch (err) { console.error('[Expert] removeRecommendation exception:', err); return false; }
}

/* ═══════════════════════════════════════════════
   VISIT HISTORY
   ═══════════════════════════════════════════════ */

export interface VisitRecord {
  id: string;
  user_id: string;
  restaurant_id: string;
  score: number;
  notes: string;
  visit_date: string;
  tags: string[];
  would_return: boolean;
  photos: { url: string; caption: string; isFavorite: boolean }[];
  friend_ids: string[];
  created_at: string;
}

/** Save a previous rating as a visit history record. */
export async function saveVisitRecord(
  userId: string,
  data: {
    restaurantId: string;
    score: number;
    notes: string;
    visitDate: string;
    tags: string[];
    wouldReturn: boolean;
    photos: { url: string; caption: string; isFavorite: boolean }[];
    friendIds: string[];
  }
): Promise<boolean> {
  if (!supabaseConfigured || !userId) return false;
  try {
    const { error } = await supabase.from('visit_history').insert({
      user_id: userId,
      restaurant_id: data.restaurantId,
      score: data.score,
      notes: data.notes,
      visit_date: data.visitDate,
      tags: data.tags,
      would_return: data.wouldReturn,
      photos: data.photos,
      friend_ids: data.friendIds,
    });
    // PGRST205 = the visit_history table doesn't exist on this deployment.
    // History is persisted durably via the user_app_data blob instead
    // (ListsContext.__visit_history__), so treat a missing table as a no-op
    // rather than spamming the console on every save.
    if (error) { if ((error as { code?: string }).code !== 'PGRST205') console.error('[VisitHistory] saveVisitRecord error:', error); return false; }
    return true;
  } catch (err) { console.error('[VisitHistory] saveVisitRecord exception:', err); return false; }
}

/** Get visit history for a user + restaurant, ordered by visit date DESC. */
export async function getVisitHistory(userId: string, restaurantId: string): Promise<VisitRecord[]> {
  if (!supabaseConfigured || !userId || !restaurantId) return [];
  try {
    const { data, error } = await supabase.from('visit_history')
      .select('*').eq('user_id', userId).eq('restaurant_id', restaurantId)
      .order('created_at', { ascending: false });
    if (error) { if ((error as { code?: string }).code !== 'PGRST205') console.error('[VisitHistory] getVisitHistory error:', error); return []; }
    return (data || []) as VisitRecord[];
  } catch (err) { console.error('[VisitHistory] getVisitHistory exception:', err); return []; }
}

/** Delete a visit history record. */
export async function deleteVisitRecord(userId: string, recordId: string): Promise<boolean> {
  if (!supabaseConfigured || !userId || !recordId) return false;
  try {
    const { error } = await supabase.from('visit_history')
      .delete().eq('user_id', userId).eq('id', recordId);
    if (error) { if ((error as { code?: string }).code !== 'PGRST205') console.error('[VisitHistory] deleteVisitRecord error:', error); return false; }
    return true;
  } catch (err) { console.error('[VisitHistory] deleteVisitRecord exception:', err); return false; }
}

/** Delete every visit history record for a (user, restaurant) pair.
 *  Used when the user removes their rating entirely — without this
 *  the next time they rate the same place their previous history
 *  resurfaces, even though the "current" rating is gone. */
export async function deleteAllVisitRecordsForRestaurant(
  userId: string,
  restaurantId: string,
): Promise<boolean> {
  if (!supabaseConfigured || !userId || !restaurantId) return false;
  try {
    const { error } = await supabase.from('visit_history')
      .delete().eq('user_id', userId).eq('restaurant_id', restaurantId);
    if (error) { if ((error as { code?: string }).code !== 'PGRST205') console.error('[VisitHistory] deleteAllVisitRecordsForRestaurant error:', error); return false; }
    return true;
  } catch (err) { console.error('[VisitHistory] deleteAllVisitRecordsForRestaurant exception:', err); return false; }
}
