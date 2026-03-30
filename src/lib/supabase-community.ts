/**
 * Community ratings & photos — shared data across all users.
 */
import { supabase, supabaseConfigured } from './supabase';

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
  if (!supabaseConfigured || !userId || photos.length === 0) return false;
  try {
    // Remove existing photos for this user+restaurant first
    await supabase.from('community_photos').delete().eq('user_id', userId).eq('restaurant_id', restaurantId);
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
export async function getCommunityPhotos(restaurantId: string): Promise<CommunityPhoto[]> {
  if (!supabaseConfigured) return [];
  try {
    const { data, error } = await supabase.from('community_photos')
      .select('*').eq('restaurant_id', restaurantId).order('created_at', { ascending: false });
    if (error) { console.error('[Community] getPhotos error:', error); return []; }
    return (data || []) as CommunityPhoto[];
  } catch (err) { console.error('[Community] getPhotos exception:', err); return []; }
}

/* ── User Profiles ── */

export interface UserProfile {
  user_id: string;
  display_name: string;
  username: string;
  bio: string;
  is_public: boolean;
  is_expert: boolean;
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

export async function saveProfile(userId: string, displayName: string, username: string, bio?: string, isPublic?: boolean, isExpert?: boolean): Promise<{ success: boolean; error?: string }> {
  if (!supabaseConfigured || !userId) return { success: false, error: 'Not configured' };
  try {
    const payload: any = {
      user_id: userId, display_name: displayName, username: username.toLowerCase().trim(),
      updated_at: new Date().toISOString(),
    };
    if (bio !== undefined) payload.bio = bio;
    if (isPublic !== undefined) payload.is_public = isPublic;
    if (isExpert !== undefined) payload.is_expert = isExpert;
    const { error } = await supabase.from('user_profiles').upsert(payload, { onConflict: 'user_id' });
    if (error) {
      if (error.code === '23505') return { success: false, error: 'Username is already taken' };
      return { success: false, error: error.message };
    }
    return { success: true };
  } catch (err) { return { success: false, error: String(err) }; }
}

export async function searchUsersByUsername(query: string, currentUserId: string): Promise<UserProfile[]> {
  if (!supabaseConfigured) return [];
  try {
    let q = supabase.from('user_profiles').select('*').neq('user_id', currentUserId).limit(20);
    if (query.trim()) q = q.ilike('username', `%${query.trim()}%`);
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

/** Get a user's wishlist items from user_app_data */
export async function getUserWishlist(userId: string): Promise<{ restaurantId: string; name: string; cuisine: string; price: string; address: string; notes: string }[]> {
  if (!supabaseConfigured || !userId) return [];
  try {
    const { data, error } = await supabase.from('user_app_data')
      .select('wishlist').eq('user_id', userId).single();
    if (error || !data) return [];
    return ((data.wishlist as any[]) || []).map((w: any) => ({
      restaurantId: w.restaurantId, name: w.name, cuisine: w.cuisine || '',
      price: w.price || '', address: w.address || '', notes: w.notes || '',
    }));
  } catch { return []; }
}

/** Get a user's lists from user_app_data (includes wishlist as first item) */
export async function getUserLists(userId: string): Promise<{ id: string; name: string; emoji: string; restaurantIds: string[] }[]> {
  if (!supabaseConfigured || !userId) return [];
  try {
    const { data, error } = await supabase.from('user_app_data')
      .select('lists, wishlist').eq('user_id', userId).single();
    if (error || !data) return [];

    const result: { id: string; name: string; emoji: string; restaurantIds: string[] }[] = [];

    // Wishlist always first
    const wishlistItems = (data.wishlist as any[]) || [];
    if (wishlistItems.length > 0) {
      result.push({ id: '__wishlist__', name: 'Wishlist', emoji: '❤️', restaurantIds: wishlistItems.map((w: any) => w.restaurantId) });
    }

    // Then regular lists
    const lists = (data.lists as any[]) || [];
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
    const { data: experts } = await supabase.from('user_profiles').select('user_id').eq('is_expert', true);
    if (!experts || experts.length === 0) return [];
    const expertIds = experts.map((e: any) => e.user_id);
    const { data, error } = await supabase.from('community_ratings')
      .select('*').in('user_id', expertIds).order('updated_at', { ascending: false }).limit(limit);
    if (error) return [];
    return (data || []) as CommunityRating[];
  } catch { return []; }
}

/** Get all ratings from user's friends (for friends map) */
export async function getAllFriendRatings(userId: string): Promise<CommunityRating[]> {
  if (!supabaseConfigured || !userId) return [];
  try {
    const friends = await getFriends(userId);
    if (friends.length === 0) return [];
    const friendIds = friends.map((f) => f.friend_id);
    const { data, error } = await supabase.from('community_ratings')
      .select('*').in('user_id', friendIds).order('updated_at', { ascending: false });
    if (error) return [];
    return (data || []) as CommunityRating[];
  } catch { return []; }
}

/* ── Likes & Comments ── */

export interface ActivityComment {
  id: string;
  user_id: string;
  rating_id: string;
  text: string;
  created_at: string;
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

export async function addComment(userId: string, ratingId: string, text: string): Promise<boolean> {
  if (!supabaseConfigured || !userId || !text.trim()) return false;
  try {
    const { error } = await supabase.from('activity_comments')
      .insert({ user_id: userId, rating_id: ratingId, text: text.trim() });
    return !error;
  } catch { return false; }
}

export async function getComments(ratingId: string): Promise<ActivityComment[]> {
  if (!supabaseConfigured) return [];
  try {
    const { data, error } = await supabase.from('activity_comments')
      .select('*').eq('rating_id', ratingId).order('created_at', { ascending: true });
    if (error) return [];
    return (data || []) as ActivityComment[];
  } catch { return []; }
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

/** Accept a friend request (updates status and creates reverse follow) */
export async function acceptFriendRequest(requestId: string, userId: string, requesterId: string): Promise<boolean> {
  if (!supabaseConfigured) return false;
  try {
    // Update the request to accepted
    const { error: updateErr } = await supabase.from('user_friends')
      .update({ status: 'accepted' }).eq('id', requestId);
    if (updateErr) { console.error('[Friends] accept update error:', updateErr); return false; }
    // Create reverse friendship (so both can see each other)
    await supabase.from('user_friends')
      .upsert({ user_id: userId, friend_id: requesterId, status: 'accepted' }, { onConflict: 'user_id,friend_id' });
    return true;
  } catch (err) { console.error('[Friends] accept exception:', err); return false; }
}

/** Decline/delete a friend request */
export async function declineFriendRequest(requestId: string): Promise<boolean> {
  if (!supabaseConfigured) return false;
  try {
    const { error } = await supabase.from('user_friends').delete().eq('id', requestId);
    if (error) { console.error('[Friends] decline error:', error); return false; }
    return true;
  } catch (err) { console.error('[Friends] decline exception:', err); return false; }
}

/** Add a friend by their user ID (legacy - now sends request) */
export async function addFriend(userId: string, friendId: string): Promise<boolean> {
  return sendFriendRequest(userId, friendId);
}

/** Remove a friend */
export async function removeFriend(userId: string, friendId: string): Promise<boolean> {
  if (!supabaseConfigured || !userId) return false;
  try {
    const { error } = await supabase.from('user_friends')
      .delete().eq('user_id', userId).eq('friend_id', friendId);
    if (error) { console.error('[Friends] removeFriend error:', error); return false; }
    return true;
  } catch (err) { console.error('[Friends] removeFriend exception:', err); return false; }
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
      .select('*').eq('is_expert', true);
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
    if (error) { console.error('[VisitHistory] saveVisitRecord error:', error); return false; }
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
    if (error) { console.error('[VisitHistory] getVisitHistory error:', error); return []; }
    return (data || []) as VisitRecord[];
  } catch (err) { console.error('[VisitHistory] getVisitHistory exception:', err); return []; }
}

/** Delete a visit history record. */
export async function deleteVisitRecord(userId: string, recordId: string): Promise<boolean> {
  if (!supabaseConfigured || !userId || !recordId) return false;
  try {
    const { error } = await supabase.from('visit_history')
      .delete().eq('user_id', userId).eq('id', recordId);
    if (error) { console.error('[VisitHistory] deleteVisitRecord error:', error); return false; }
    return true;
  } catch (err) { console.error('[VisitHistory] deleteVisitRecord exception:', err); return false; }
}
