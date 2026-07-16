/**
 * Community ratings & photos — shared data across all users.
 */
import { supabase, supabaseConfigured } from './supabase';
import type { HomeMeal } from '../contexts/ListsContext';

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
export async function publishCommunityRating(
  userId: string,
  restaurantId: string,
  data: { name: string; score: number; notes: string; cuisine: string; price: string; address: string; visitDate: string; tags: string[]; wouldReturn: boolean; friendIds?: string[]; lat?: number; lng?: number; photoUrl?: string }
): Promise<boolean> {
  if (!supabaseConfigured || !userId) return false;
  try {
    const payload: any = {
      user_id: userId,
      restaurant_id: restaurantId,
      restaurant_name: data.name,
      score: data.score,
      notes: data.notes,
      cuisine: data.cuisine,
      price: data.price,
      address: data.address,
      visit_date: data.visitDate,
      tags: data.tags,
      would_return: data.wouldReturn,
      friend_ids: data.friendIds || [],
      updated_at: new Date().toISOString(),
    };
    if (data.lat != null) payload.lat = data.lat;
    if (data.lng != null) payload.lng = data.lng;
    if (data.photoUrl) payload.photo_url = data.photoUrl;
    const { error } = await supabase.from('community_ratings').upsert(payload, { onConflict: 'user_id,restaurant_id' });
    if (error) { console.error('[Community] publishRating error:', error); return false; }
    return true;
  } catch (err) { console.error('[Community] publishRating exception:', err); return false; }
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
    const avgScore = ratings.length > 0 ? ratings.reduce((sum, r) => sum + Number(r.score), 0) / ratings.length : 0;
    return { avgScore, totalRatings: ratings.length, ratings };
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
      .select('restaurant_id, user_id, score')
      .in('restaurant_id', ids);
    if (error) { console.error('[Community] getCommunityRatingStats error:', error); return {}; }
    const acc: Record<string, { users: Set<string>; sum: number; n: number }> = {};
    for (const row of (data || []) as Array<{ restaurant_id: string; user_id: string; score: number | null }>) {
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
    const avgScore = ratings.length > 0 ? ratings.reduce((sum, r) => sum + Number(r.score), 0) / ratings.length : 0;
    return { avgScore, totalRatings: ratings.length, ratings };
  } catch (err) { console.error('[Community] getFriendsStats exception:', err); return { avgScore: 0, totalRatings: 0, ratings: [] }; }
}

/**
 * Remove a user's community photos for a restaurant.
 */
export async function removeCommunityPhotos(userId: string, restaurantId: string): Promise<boolean> {
  if (!supabaseConfigured || !userId) return false;
  try {
    await supabase.from('community_photos').delete().eq('user_id', userId).eq('restaurant_id', restaurantId);
    return true;
  } catch { return false; }
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

export async function getProfileByUsername(username: string): Promise<UserProfile | null> {
  if (!supabaseConfigured || !username.trim()) return null;
  try {
    const { data, error } = await supabase.from('user_profiles')
      .select('*').ilike('username', username.trim()).single();
    if (error) return null;
    return data as UserProfile;
  } catch { return null; }
}

export async function saveProfile(
  userId: string,
  displayName: string,
  username: string,
  bio?: string,
  isPublic?: boolean,
  homeBase?: SaveProfileHomeBase,
): Promise<{ success: boolean; error?: string }> {
  if (!supabaseConfigured || !userId) return { success: false, error: 'Not configured' };
  try {
    const payload: any = {
      user_id: userId, display_name: displayName, username: username.toLowerCase().trim(),
      updated_at: new Date().toISOString(),
    };
    if (bio !== undefined) payload.bio = bio;
    if (isPublic !== undefined) payload.is_public = isPublic;
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
    const { error } = await supabase.from('user_profiles').upsert(payload, { onConflict: 'user_id' });
    if (error) {
      if (error.code === '23505') return { success: false, error: 'Username is already taken' };
      return { success: false, error: error.message };
    }
    return { success: true };
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

/** Get follower and following counts */
export async function getFollowCounts(userId: string): Promise<{ followers: number; following: number }> {
  if (!supabaseConfigured || !userId) return { followers: 0, following: 0 };
  try {
    const [{ count: following }, { count: followers }] = await Promise.all([
      supabase.from('user_friends').select('*', { count: 'exact', head: true }).eq('user_id', userId).eq('status', 'accepted'),
      supabase.from('user_friends').select('*', { count: 'exact', head: true }).eq('friend_id', userId).eq('status', 'accepted'),
    ]);
    return { followers: followers || 0, following: following || 0 };
  } catch { return { followers: 0, following: 0 }; }
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

export async function toggleLike(userId: string, ratingId: string): Promise<boolean> {
  if (!supabaseConfigured || !userId) return false;
  try {
    const { data } = await supabase.from('activity_likes')
      .select('id').eq('user_id', userId).eq('rating_id', ratingId).single();
    if (data) {
      await supabase.from('activity_likes').delete().eq('id', data.id);
    } else {
      await supabase.from('activity_likes').insert({ user_id: userId, rating_id: ratingId });
    }
    return true;
  } catch { return false; }
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

/** Send a friend request (status = 'pending') */
export async function sendFriendRequest(userId: string, friendId: string): Promise<boolean> {
  if (!supabaseConfigured || !userId || !friendId || userId === friendId) return false;
  try {
    const { error } = await supabase.from('user_friends')
      .insert({ user_id: userId, friend_id: friendId, status: 'pending' });
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
    return (data || []) as CommunityRating[];
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

/* ─── Hotel Dining ─── */

export type DiningType = 'breakfast' | 'restaurant' | 'bar' | 'room_service' | 'pool_bar' | 'rooftop';

export interface HotelDining {
  id: string;
  hotel_place_id: string;
  hotel_name: string;
  hotel_address: string;
  restaurant_place_id: string;
  restaurant_name: string;
  dining_type: DiningType;
  added_by: string;
  created_at: string;
}

/** Get all dining options for a hotel. */
export async function getHotelDining(hotelPlaceId: string): Promise<HotelDining[]> {
  if (!supabaseConfigured || !hotelPlaceId) return [];
  try {
    const { data, error } = await supabase.from('hotel_dining')
      .select('*').eq('hotel_place_id', hotelPlaceId).order('created_at', { ascending: false });
    if (error) { console.error('[HotelDining] getHotelDining error:', error); return []; }
    return (data || []) as HotelDining[];
  } catch (err) { console.error('[HotelDining] getHotelDining exception:', err); return []; }
}

/** Add a dining option to a hotel. */
export async function addHotelDining(
  userId: string,
  data: { hotelPlaceId: string; hotelName: string; hotelAddress: string; restaurantPlaceId: string; restaurantName: string; diningType: DiningType }
): Promise<boolean> {
  if (!supabaseConfigured || !userId) return false;
  try {
    const { error } = await supabase.from('hotel_dining').upsert({
      hotel_place_id: data.hotelPlaceId,
      hotel_name: data.hotelName,
      hotel_address: data.hotelAddress,
      restaurant_place_id: data.restaurantPlaceId,
      restaurant_name: data.restaurantName,
      dining_type: data.diningType,
      added_by: userId,
    }, { onConflict: 'hotel_place_id,restaurant_place_id' });
    if (error) { console.error('[HotelDining] addHotelDining error:', error); return false; }
    return true;
  } catch (err) { console.error('[HotelDining] addHotelDining exception:', err); return false; }
}

/** Remove a dining option from a hotel. */
export async function removeHotelDining(userId: string, hotelPlaceId: string, restaurantPlaceId: string): Promise<boolean> {
  if (!supabaseConfigured || !userId) return false;
  try {
    const { error } = await supabase.from('hotel_dining')
      .delete().eq('added_by', userId).eq('hotel_place_id', hotelPlaceId).eq('restaurant_place_id', restaurantPlaceId);
    if (error) { console.error('[HotelDining] removeHotelDining error:', error); return false; }
    return true;
  } catch (err) { console.error('[HotelDining] removeHotelDining exception:', err); return false; }
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
