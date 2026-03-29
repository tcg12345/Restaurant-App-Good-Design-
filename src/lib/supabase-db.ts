/**
 * Supabase persistence layer for user restaurant data.
 * Stores ratings, lists, wishlist, and metadata as JSONB in a single row per user.
 */
import { supabase, supabaseConfigured } from './supabase';
import type { RestaurantRating, CustomList, WishlistItem, RestaurantMeta, Trip } from '../contexts/ListsContext';

export interface UserAppData {
  ratings: RestaurantRating[];
  lists: CustomList[];
  wishlist: WishlistItem[];
  restaurantMeta: Record<string, RestaurantMeta>;
  recentViews: any[];
  trips: Trip[];
}

/**
 * Load all user data from Supabase. Returns null if not found or not configured.
 */
export async function loadUserData(userId: string): Promise<UserAppData | null> {
  if (!supabaseConfigured || !userId) return null;

  try {
    // Try loading with trips column first; fall back without it if column doesn't exist yet
    let { data, error } = await supabase
      .from('user_app_data')
      .select('ratings, lists, wishlist, restaurant_meta, recent_views, trips')
      .eq('user_id', userId)
      .single();

    // If the trips column doesn't exist yet, retry without it
    if (error && !data && error.code !== 'PGRST116') {
      const fallback = await supabase
        .from('user_app_data')
        .select('ratings, lists, wishlist, restaurant_meta, recent_views')
        .eq('user_id', userId)
        .single();
      data = fallback.data as any;
      error = fallback.error;
    }

    if (error) {
      if (error.code === 'PGRST116') return null; // no rows found
      console.error('[Supabase] loadUserData error:', error);
      return null;
    }

    return {
      ratings: (data.ratings as RestaurantRating[]) || [],
      lists: (data.lists as CustomList[]) || [],
      wishlist: (data.wishlist as WishlistItem[]) || [],
      restaurantMeta: (data.restaurant_meta as Record<string, RestaurantMeta>) || {},
      recentViews: (data.recent_views as any[]) || [],
      trips: ((data as any).trips as Trip[]) || [],
    };
  } catch (err) {
    console.error('[Supabase] loadUserData exception:', err);
    return null;
  }
}

/**
 * Save all user data to Supabase (upsert — creates row if needed).
 * This is the ONLY function that should create new rows.
 */
export async function saveUserData(userId: string, data: UserAppData): Promise<boolean> {
  if (!supabaseConfigured || !userId) return false;

  try {
    // Try saving with trips; fall back without if column doesn't exist
    let { error } = await supabase
      .from('user_app_data')
      .upsert({
        user_id: userId,
        ratings: data.ratings,
        lists: data.lists,
        wishlist: data.wishlist,
        restaurant_meta: data.restaurantMeta,
        recent_views: data.recentViews || [],
        trips: data.trips || [],
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });

    if (error) {
      // Retry without trips column
      const fallback = await supabase
        .from('user_app_data')
        .upsert({
          user_id: userId,
          ratings: data.ratings,
          lists: data.lists,
          wishlist: data.wishlist,
          restaurant_meta: data.restaurantMeta,
          recent_views: data.recentViews || [],
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' });
      error = fallback.error;
    }

    if (error) {
      console.error('[Supabase] saveUserData error:', error);
      return false;
    }

    console.log('[Supabase] Saved all user data');
    return true;
  } catch (err) {
    console.error('[Supabase] saveUserData exception:', err);
    return false;
  }
}

/**
 * Ensure a row exists for this user. Call once after first sign-in.
 */
async function ensureRow(userId: string): Promise<void> {
  const { data } = await supabase
    .from('user_app_data')
    .select('user_id')
    .eq('user_id', userId)
    .single();

  if (!data) {
    // Create the row with defaults
    await supabase.from('user_app_data').insert({
      user_id: userId,
      ratings: [],
      lists: [],
      wishlist: [],
      restaurant_meta: {},
      updated_at: new Date().toISOString(),
    });
  }
}

/**
 * Partial update helpers — use UPDATE (not upsert) to avoid overwriting other columns.
 * These only work if the row already exists (ensured by loadUserData/saveUserData).
 */
export async function saveRatings(userId: string, ratings: RestaurantRating[]): Promise<boolean> {
  if (!supabaseConfigured || !userId) return false;
  try {
    await ensureRow(userId);
    const { error } = await supabase
      .from('user_app_data')
      .update({ ratings, updated_at: new Date().toISOString() })
      .eq('user_id', userId);
    if (error) { console.error('[Supabase] saveRatings error:', error); return false; }
    return true;
  } catch (err) { console.error('[Supabase] saveRatings exception:', err); return false; }
}

export async function saveLists(userId: string, lists: CustomList[]): Promise<boolean> {
  if (!supabaseConfigured || !userId) return false;
  try {
    await ensureRow(userId);
    const { error } = await supabase
      .from('user_app_data')
      .update({ lists, updated_at: new Date().toISOString() })
      .eq('user_id', userId);
    if (error) { console.error('[Supabase] saveLists error:', error); return false; }
    return true;
  } catch (err) { console.error('[Supabase] saveLists exception:', err); return false; }
}

export async function saveWishlistData(userId: string, wishlist: WishlistItem[]): Promise<boolean> {
  if (!supabaseConfigured || !userId) return false;
  try {
    await ensureRow(userId);
    const { error } = await supabase
      .from('user_app_data')
      .update({ wishlist, updated_at: new Date().toISOString() })
      .eq('user_id', userId);
    if (error) { console.error('[Supabase] saveWishlist error:', error); return false; }
    return true;
  } catch (err) { console.error('[Supabase] saveWishlist exception:', err); return false; }
}

export async function saveMetaData(userId: string, restaurantMeta: Record<string, RestaurantMeta>): Promise<boolean> {
  if (!supabaseConfigured || !userId) return false;
  try {
    await ensureRow(userId);
    const { error } = await supabase
      .from('user_app_data')
      .update({ restaurant_meta: restaurantMeta, updated_at: new Date().toISOString() })
      .eq('user_id', userId);
    if (error) { console.error('[Supabase] saveMeta error:', error); return false; }
    return true;
  } catch (err) { console.error('[Supabase] saveMeta exception:', err); return false; }
}

export async function saveRecentViews(userId: string, recentViews: any[]): Promise<boolean> {
  if (!supabaseConfigured || !userId) return false;
  try {
    await ensureRow(userId);
    const { error } = await supabase
      .from('user_app_data')
      .update({ recent_views: recentViews, updated_at: new Date().toISOString() })
      .eq('user_id', userId);
    if (error) { console.error('[Supabase] saveRecentViews error:', error); return false; }
    return true;
  } catch (err) { console.error('[Supabase] saveRecentViews exception:', err); return false; }
}

export async function saveTrips(userId: string, trips: Trip[]): Promise<boolean> {
  if (!supabaseConfigured || !userId) return false;
  try {
    await ensureRow(userId);
    const { error } = await supabase
      .from('user_app_data')
      .update({ trips, updated_at: new Date().toISOString() })
      .eq('user_id', userId);
    // Silently ignore if trips column doesn't exist yet
    if (error) { console.warn('[Supabase] saveTrips error (trips column may not exist yet):', error.message); return false; }
    return true;
  } catch (err) { console.warn('[Supabase] saveTrips exception:', err); return false; }
}
