/**
 * Supabase persistence layer for user restaurant data.
 * Stores ratings, lists, wishlist, and metadata as JSONB in a single row per user.
 */
import { supabase, supabaseConfigured } from './supabase';
import type { RestaurantRating, CustomList, WishlistItem, RestaurantMeta, Trip, HomeMeal } from '../contexts/ListsContext';

function asArray<T>(v: unknown, fallback: T[]): T[] {
  return Array.isArray(v) ? (v as T[]) : fallback;
}

// Chats deliberately absent: conversations live in the shared
// conversations/messages tables (migration 037, see ChatContext), never in
// this per-user blob.
export interface UserAppData {
  ratings: RestaurantRating[];
  lists: CustomList[];
  wishlist: WishlistItem[];
  restaurantMeta: Record<string, RestaurantMeta>;
  recentViews: unknown[];
  trips: Trip[];
  homeMeals: HomeMeal[];
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
        .select('ratings, lists, wishlist, restaurant_meta, recent_views, trips, home_meals')
        .eq('user_id', userId)
        .single();

      // Fallback without trips/home_meals if those columns don't exist yet
      // (schema drift — their data still round-trips via the restaurant_meta
      // __trips__/__home_meals__ mirrors that ListsContext maintains).
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
/** Columns that may be absent on live schemas that predate their
 *  migrations. Only these may be dropped from a failed upsert. */
const OPTIONAL_COLUMNS = ['trips', 'home_meals'];

/** When PostgREST rejects a write because a column doesn't exist
 *  (PGRST204: "Could not find the 'X' column ..."), return that column
 *  name — but only if it's one we consider optional. */
function missingOptionalColumn(error: { code?: string; message?: string } | null): string | null {
  if (!error || error.code !== 'PGRST204') return null;
  const m = /Could not find the '([^']+)' column/i.exec(error.message || '');
  const col = m?.[1];
  return col && OPTIONAL_COLUMNS.includes(col) ? col : null;
}

export async function saveUserData(userId: string, data: UserAppData): Promise<boolean> {
  if (!supabaseConfigured || !userId) return false;

  try {
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

    // Retry dropping ONLY the specific column PostgREST reports as missing
    // (schema drift). The old blanket fallback re-sent the payload without
    // trips AND home_meals, so one missing column silently stopped the
    // other from ever persisting.
    for (let attempt = 0; attempt <= OPTIONAL_COLUMNS.length; attempt++) {
      const { error } = await supabase
        .from('user_app_data')
        .upsert(payload, { onConflict: 'user_id' });
      if (!error) return true;

      const missing = missingOptionalColumn(error);
      if (!missing || !(missing in payload)) {
        console.error('[Supabase] saveUserData error:', error);
        return false;
      }
      console.warn(`[Supabase] saveUserData: '${missing}' column missing on this schema — retrying without it (its data persists via the restaurant_meta mirror)`);
      delete payload[missing];
    }
    return false;
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

