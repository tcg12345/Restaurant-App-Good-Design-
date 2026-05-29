/**
 * Supabase persistence layer for user restaurant data.
 * Stores ratings, lists, wishlist, and metadata as JSONB in a single row per user.
 */
import { supabase, supabaseConfigured } from './supabase';
import type { RestaurantRating, CustomList, WishlistItem, RestaurantMeta, Trip, HomeMeal } from '../contexts/ListsContext';
import type { Conversation } from '../contexts/ChatContext';

function asArray<T>(v: unknown, fallback: T[]): T[] {
  return Array.isArray(v) ? (v as T[]) : fallback;
}

export interface UserAppData {
  ratings: RestaurantRating[];
  lists: CustomList[];
  wishlist: WishlistItem[];
  restaurantMeta: Record<string, RestaurantMeta>;
  recentViews: unknown[];
  trips: Trip[];
  homeMeals: HomeMeal[];
  chats?: Conversation[];
  chatsRead?: Record<string, number>;
}

/**
 * Load all user data from Supabase. Returns null if not found or not configured.
 */
export async function loadUserData(userId: string): Promise<UserAppData | null> {
  if (!supabaseConfigured || !userId) return null;

  // CRITICAL: a transient/network failure must never be mistaken for an empty
  // account. The caller treats `null` as "no row exists" and overwrites the
  // cloud with local data — which WIPES the user's recipes/ratings when local
  // is empty (fresh browser, post-"different user" clear, etc.). So we retry
  // transient failures and THROW on a real error; `null` is returned ONLY for
  // a genuine missing row (PGRST116).
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      // Try loading with newest columns first; fall back without them if the
      // schema hasn't been migrated yet.
      let { data, error } = await supabase
        .from('user_app_data')
        .select('ratings, lists, wishlist, restaurant_meta, recent_views, trips, home_meals, chats, chats_read')
        .eq('user_id', userId)
        .single();

      // Retry without chats columns if they don't exist yet (schema drift)
      if (error && !data && error.code !== 'PGRST116') {
        const retry = await supabase
          .from('user_app_data')
          .select('ratings, lists, wishlist, restaurant_meta, recent_views, trips, home_meals')
          .eq('user_id', userId)
          .single();
        data = retry.data as typeof data;
        error = retry.error;
      }

      // Final fallback without trips/home_meals either
      if (error && !data && error.code !== 'PGRST116') {
        const fallback = await supabase
          .from('user_app_data')
          .select('ratings, lists, wishlist, restaurant_meta, recent_views')
          .eq('user_id', userId)
          .single();
        data = fallback.data as typeof data;
        error = fallback.error;
      }

      if (error) {
        if (error.code === 'PGRST116') return null; // genuine: no row for this user
        // A real error (network/timeout/permission/etc.). Throw so the caller
        // keeps local data instead of treating the account as empty.
        throw new Error(`loadUserData query error: ${error.message || error.code || 'unknown'}`);
      }

      return {
        ratings: asArray<RestaurantRating>(data.ratings, []),
        lists: asArray<CustomList>(data.lists, []),
        wishlist: asArray<WishlistItem>(data.wishlist, []),
        restaurantMeta: (data.restaurant_meta && typeof data.restaurant_meta === 'object' && !Array.isArray(data.restaurant_meta)
          ? data.restaurant_meta
          : {}) as Record<string, RestaurantMeta>,
        recentViews: asArray<unknown>(data.recent_views, []),
        trips: asArray<Trip>((data as Record<string, unknown>).trips, []),
        homeMeals: asArray<HomeMeal>((data as Record<string, unknown>).home_meals, []),
        chats: asArray<Conversation>((data as Record<string, unknown>).chats, []),
        chatsRead: ((data as Record<string, unknown>).chats_read && typeof (data as Record<string, unknown>).chats_read === 'object' && !Array.isArray((data as Record<string, unknown>).chats_read)
          ? (data as Record<string, unknown>).chats_read
          : {}) as Record<string, number>,
      };
    } catch (err) {
      lastError = err;
      if (attempt < 2) {
        // Back off briefly and retry — covers slow networks / cold starts.
        await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
        continue;
      }
    }
  }
  // All attempts failed with a real error — propagate so the caller preserves
  // existing data and does NOT overwrite the cloud.
  console.error('[Supabase] loadUserData failed after retries:', lastError);
  throw lastError instanceof Error ? lastError : new Error('loadUserData failed after retries');
}

/**
 * Save all user data to Supabase (upsert — creates row if needed).
 * This is the ONLY function that should create new rows.
 */
export async function saveUserData(userId: string, data: UserAppData): Promise<boolean> {
  if (!supabaseConfigured || !userId) return false;

  try {
    // Only include chats/chats_read in the upsert when caller provided them.
    // Otherwise we'd silently wipe out conversations whenever ListsContext
    // reconciles ratings/lists without touching chat state.
    const payload: Record<string, unknown> = {
      user_id: userId,
      ratings: data.ratings,
      lists: data.lists,
      wishlist: data.wishlist,
      restaurant_meta: data.restaurantMeta,
      recent_views: data.recentViews || [],
      trips: data.trips || [],
      home_meals: data.homeMeals || [],
      updated_at: new Date().toISOString(),
    };
    if (data.chats !== undefined) payload.chats = data.chats;
    if (data.chatsRead !== undefined) payload.chats_read = data.chatsRead;

    // Try saving with trips; fall back without if column doesn't exist
    let { error } = await supabase
      .from('user_app_data')
      .upsert(payload, { onConflict: 'user_id' });

    if (error) {
      // Retry without newer columns
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
  const { data, error } = await supabase
    .from('user_app_data')
    .select('user_id')
    .eq('user_id', userId)
    .single();

  if (error && error.code !== 'PGRST116') {
    console.error('[Supabase] ensureRow check error:', error);
  }

  if (!data) {
    const { error: insertErr } = await supabase.from('user_app_data').insert({
      user_id: userId,
      ratings: [],
      lists: [],
      wishlist: [],
      restaurant_meta: {},
      updated_at: new Date().toISOString(),
    });
    if (insertErr) {
      console.error('[Supabase] ensureRow insert error:', insertErr);
    }
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

export async function saveRecentViews(userId: string, recentViews: unknown[]): Promise<boolean> {
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

export async function saveHomeMeals(userId: string, homeMeals: HomeMeal[]): Promise<boolean> {
  if (!supabaseConfigured || !userId) return false;
  try {
    await ensureRow(userId);
    const { error } = await supabase
      .from('user_app_data')
      .update({ home_meals: homeMeals, updated_at: new Date().toISOString() })
      .eq('user_id', userId);
    if (error) { console.warn('[Supabase] saveHomeMeals error (column may not exist yet):', error.message); return false; }
    return true;
  } catch (err) { console.warn('[Supabase] saveHomeMeals exception:', err); return false; }
}

export async function saveChats(userId: string, chats: Conversation[], chatsRead: Record<string, number>): Promise<boolean> {
  if (!supabaseConfigured || !userId) return false;
  try {
    await ensureRow(userId);
    const { error } = await supabase
      .from('user_app_data')
      .update({ chats, chats_read: chatsRead, updated_at: new Date().toISOString() })
      .eq('user_id', userId);
    if (error) { console.warn('[Supabase] saveChats error (column may not exist yet):', error.message); return false; }
    return true;
  } catch (err) { console.warn('[Supabase] saveChats exception:', err); return false; }
}
