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
  data: { name: string; score: number; notes: string; cuisine: string; price: string; address: string; visitDate: string; tags: string[]; wouldReturn: boolean }
): Promise<boolean> {
  if (!supabaseConfigured || !userId) return false;
  try {
    const { error } = await supabase.from('community_ratings').upsert({
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
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,restaurant_id' });
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

export async function saveProfile(userId: string, displayName: string, username: string): Promise<{ success: boolean; error?: string }> {
  if (!supabaseConfigured || !userId) return { success: false, error: 'Not configured' };
  try {
    const { error } = await supabase.from('user_profiles').upsert({
      user_id: userId, display_name: displayName, username: username.toLowerCase().trim(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });
    if (error) {
      if (error.code === '23505') return { success: false, error: 'Username is already taken' };
      return { success: false, error: error.message };
    }
    return { success: true };
  } catch (err) { return { success: false, error: String(err) }; }
}

export async function searchUsersByUsername(query: string, currentUserId: string): Promise<UserProfile[]> {
  if (!supabaseConfigured || !query.trim()) return [];
  try {
    const { data, error } = await supabase.from('user_profiles')
      .select('*').ilike('username', `%${query.trim()}%`).neq('user_id', currentUserId).limit(20);
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

/* ── Friend Management ── */

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
