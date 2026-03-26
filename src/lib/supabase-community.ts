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

/* ── Friend Management ── */

export interface FriendInfo {
  friend_id: string;
  email?: string;
}

/** Get the current user's friend list */
export async function getFriends(userId: string): Promise<FriendInfo[]> {
  if (!supabaseConfigured || !userId) return [];
  try {
    const { data, error } = await supabase.from('user_friends')
      .select('friend_id').eq('user_id', userId);
    if (error) { console.error('[Friends] getFriends error:', error); return []; }
    return (data || []) as FriendInfo[];
  } catch (err) { console.error('[Friends] getFriends exception:', err); return []; }
}

/** Add a friend by their user ID */
export async function addFriend(userId: string, friendId: string): Promise<boolean> {
  if (!supabaseConfigured || !userId || !friendId || userId === friendId) return false;
  try {
    const { error } = await supabase.from('user_friends')
      .insert({ user_id: userId, friend_id: friendId });
    if (error) { console.error('[Friends] addFriend error:', error); return false; }
    return true;
  } catch (err) { console.error('[Friends] addFriend exception:', err); return false; }
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
