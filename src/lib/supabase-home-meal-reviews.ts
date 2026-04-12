/**
 * Home meal (recipe) reviews.
 *
 * Recipes published by one user can be reviewed (rating 0-5 + notes) by
 * other users who discover them on the Explore tab. We try the existing
 * `recipe_reviews` table first, and fall back to storing the reviewer's
 * own review inside their `user_app_data.restaurant_meta.__my_meal_reviews__`
 * when the table doesn't exist or RLS blocks the write. This dual-write
 * approach mirrors the pattern used for home meals themselves.
 */
import { supabase, supabaseConfigured } from './supabase';

export interface HomeMealReview {
  id: string;
  userId: string;
  mealId: string;
  rating: number; // 0–5
  notes: string;
  createdAt: string;
  updatedAt: string;
}

const rowToHomeMealReview = (row: Record<string, unknown>): HomeMealReview => ({
  id: (row.id as string) || '',
  userId: (row.user_id as string) || '',
  mealId: (row.recipe_id as string) || '',
  rating: Number(row.rating) || 0,
  notes: (row.notes as string) || '',
  createdAt: (row.created_at as string) || '',
  updatedAt: (row.updated_at as string) || '',
});

// ── Meta fallback helpers ──
// Each reviewer's own reviews live under their user_app_data.restaurant_meta
// at the reserved key __my_meal_reviews__. Shaped as Record<mealId, review>.

type MetaReviewMap = Record<string, { rating: number; notes: string; updatedAt: string }>;

async function loadMyMetaReviews(userId: string): Promise<MetaReviewMap> {
  if (!supabaseConfigured || !userId) return {};
  try {
    const { data } = await supabase.from('user_app_data')
      .select('restaurant_meta')
      .eq('user_id', userId)
      .single();
    if (!data) return {};
    const meta = (data.restaurant_meta ?? {}) as Record<string, unknown>;
    const reviews = (meta.__my_meal_reviews__ ?? {}) as MetaReviewMap;
    return typeof reviews === 'object' && !Array.isArray(reviews) ? reviews : {};
  } catch { return {}; }
}

async function saveMyMetaReview(
  userId: string,
  mealId: string,
  review: { rating: number; notes: string },
): Promise<boolean> {
  if (!supabaseConfigured || !userId) return false;
  try {
    // Load the full meta, set the review, write it back.
    const { data } = await supabase.from('user_app_data')
      .select('restaurant_meta')
      .eq('user_id', userId)
      .single();
    const meta = ((data?.restaurant_meta ?? {}) as Record<string, unknown>);
    const existing = (meta.__my_meal_reviews__ ?? {}) as MetaReviewMap;
    existing[mealId] = { rating: review.rating, notes: review.notes, updatedAt: new Date().toISOString() };
    meta.__my_meal_reviews__ = existing as unknown as typeof meta[string];
    const { error } = await supabase.from('user_app_data')
      .update({ restaurant_meta: meta, updated_at: new Date().toISOString() })
      .eq('user_id', userId);
    if (error) { console.warn('[HomeMealReviews] meta fallback save error:', error.message); return false; }
    return true;
  } catch (err) {
    console.warn('[HomeMealReviews] meta fallback exception:', err);
    return false;
  }
}

// ── Public API ──

/** Create or update the current user's review for a home meal. */
export async function upsertHomeMealReview(
  userId: string,
  mealId: string,
  data: { rating: number; notes: string },
): Promise<HomeMealReview | null> {
  if (!supabaseConfigured || !userId || !mealId) return null;

  const now = new Date().toISOString();

  // Try the dedicated table first.
  try {
    const { data: row, error } = await supabase.from('recipe_reviews')
      .upsert({
        user_id: userId,
        recipe_id: mealId,
        rating: data.rating,
        notes: data.notes,
        photo: '',
        updated_at: now,
      }, { onConflict: 'user_id,recipe_id' })
      .select('*')
      .single();
    if (!error && row) {
      // Also stash in meta as a reliable fallback.
      saveMyMetaReview(userId, mealId, data).catch(() => {});
      return rowToHomeMealReview(row as Record<string, unknown>);
    }
    console.warn('[HomeMealReviews] table upsert failed, falling back to meta:', error?.message);
  } catch (err) {
    console.warn('[HomeMealReviews] table upsert exception, falling back to meta:', err);
  }

  // Fallback: store in the reviewer's own restaurant_meta.
  const ok = await saveMyMetaReview(userId, mealId, data);
  if (ok) {
    return {
      id: `meta-${userId}-${mealId}`,
      userId,
      mealId,
      rating: data.rating,
      notes: data.notes,
      createdAt: now,
      updatedAt: now,
    };
  }
  return null;
}

/** Delete the current user's review for a home meal. */
export async function deleteHomeMealReview(
  userId: string,
  mealId: string,
): Promise<boolean> {
  if (!supabaseConfigured || !userId || !mealId) return false;
  try {
    await supabase.from('recipe_reviews')
      .delete()
      .eq('user_id', userId)
      .eq('recipe_id', mealId);
  } catch { /* best-effort */ }
  // Also clear from meta.
  try {
    const map = await loadMyMetaReviews(userId);
    if (map[mealId]) {
      delete map[mealId];
      const { data } = await supabase.from('user_app_data')
        .select('restaurant_meta')
        .eq('user_id', userId)
        .single();
      if (data) {
        const meta = (data.restaurant_meta ?? {}) as Record<string, unknown>;
        meta.__my_meal_reviews__ = map as unknown as typeof meta[string];
        await supabase.from('user_app_data')
          .update({ restaurant_meta: meta, updated_at: new Date().toISOString() })
          .eq('user_id', userId);
      }
    }
  } catch { /* best-effort */ }
  return true;
}

/** Fetch every review for a single home meal from the table + meta fallback.
 *  Pass `scanUserIds` to also read `restaurant_meta.__my_meal_reviews__[mealId]`
 *  from those users' `user_app_data` rows — this is how reviews that were
 *  persisted via the ListsContext meta path become visible to the author. */
export async function getHomeMealReviews(
  mealId: string,
  scanUserIds: string[] = [],
): Promise<HomeMealReview[]> {
  if (!supabaseConfigured || !mealId) return [];
  const byUser = new Map<string, HomeMealReview>();

  // 1. Dedicated table (preferred — wins on duplicates).
  try {
    const { data, error } = await supabase.from('recipe_reviews')
      .select('*')
      .eq('recipe_id', mealId)
      .order('updated_at', { ascending: false });
    if (!error && data) {
      for (const r of data) {
        const review = rowToHomeMealReview(r as Record<string, unknown>);
        byUser.set(review.userId, review);
      }
    }
  } catch { /* table may not exist */ }

  // 2. Meta fallback — scan the provided users' restaurant_meta.
  if (scanUserIds.length > 0) {
    try {
      const { data, error } = await supabase.from('user_app_data')
        .select('user_id, restaurant_meta')
        .in('user_id', scanUserIds);
      if (!error && data) {
        for (const row of data) {
          const uid = (row as { user_id: string }).user_id;
          if (byUser.has(uid)) continue; // table entry wins
          const meta = (row.restaurant_meta ?? {}) as Record<string, unknown>;
          const map = (meta.__my_meal_reviews__ ?? {}) as Record<string, { rating: number; notes: string; updatedAt: string }>;
          const entry = map[mealId];
          if (entry) {
            byUser.set(uid, {
              id: `meta-${uid}-${mealId}`,
              userId: uid,
              mealId,
              rating: entry.rating,
              notes: entry.notes || '',
              createdAt: entry.updatedAt || '',
              updatedAt: entry.updatedAt || '',
            });
          }
        }
      }
    } catch { /* best-effort */ }
  }

  return Array.from(byUser.values()).sort((a, b) => {
    const at = a.updatedAt ? Date.parse(a.updatedAt) : 0;
    const bt = b.updatedAt ? Date.parse(b.updatedAt) : 0;
    return bt - at;
  });
}

/** Fetch the current user's own review for a home meal, checking both sources. */
export async function getMyHomeMealReview(
  userId: string,
  mealId: string,
): Promise<HomeMealReview | null> {
  if (!supabaseConfigured || !userId || !mealId) return null;

  // Try the dedicated table.
  try {
    const { data, error } = await supabase.from('recipe_reviews')
      .select('*')
      .eq('user_id', userId)
      .eq('recipe_id', mealId)
      .maybeSingle();
    if (!error && data) return rowToHomeMealReview(data as Record<string, unknown>);
  } catch { /* table may not exist */ }

  // Fallback: check the reviewer's meta.
  try {
    const map = await loadMyMetaReviews(userId);
    const entry = map[mealId];
    if (entry) {
      return {
        id: `meta-${userId}-${mealId}`,
        userId,
        mealId,
        rating: entry.rating,
        notes: entry.notes,
        createdAt: entry.updatedAt,
        updatedAt: entry.updatedAt,
      };
    }
  } catch { /* best-effort */ }

  return null;
}

/** Averages a list of reviews into { average, count }. */
export function summarizeReviews(reviews: HomeMealReview[]): { average: number; count: number } {
  if (reviews.length === 0) return { average: 0, count: 0 };
  const sum = reviews.reduce((acc, r) => acc + (Number.isFinite(r.rating) ? r.rating : 0), 0);
  return { average: sum / reviews.length, count: reviews.length };
}

/** Batch-fetch review summaries for multiple meal IDs. Reads from both the
 *  `recipe_reviews` table AND (optionally) from the meta fallback on each of
 *  the provided users' `user_app_data` rows, deduplicated per (meal, user). */
export async function getReviewSummariesBatch(
  mealIds: string[],
  scanUserIds: string[] = [],
): Promise<Record<string, { average: number; count: number }>> {
  const result: Record<string, { average: number; count: number }> = {};
  if (!supabaseConfigured || mealIds.length === 0) return result;
  // Map: mealId → (userId → rating). Table entries win on duplicates.
  const perMeal: Record<string, Map<string, number>> = {};

  // 1. Table.
  try {
    const { data, error } = await supabase.from('recipe_reviews')
      .select('recipe_id, user_id, rating')
      .in('recipe_id', mealIds);
    if (!error && data) {
      for (const row of data) {
        const meal = row.recipe_id as string;
        const user = row.user_id as string;
        if (!perMeal[meal]) perMeal[meal] = new Map();
        perMeal[meal].set(user, Number(row.rating) || 0);
      }
    }
  } catch { /* table may not exist */ }

  // 2. Meta fallback — scan provided users' meta for each meal.
  if (scanUserIds.length > 0) {
    try {
      const { data, error } = await supabase.from('user_app_data')
        .select('user_id, restaurant_meta')
        .in('user_id', scanUserIds);
      if (!error && data) {
        const mealIdSet = new Set(mealIds);
        for (const row of data) {
          const uid = (row as { user_id: string }).user_id;
          const meta = (row.restaurant_meta ?? {}) as Record<string, unknown>;
          const map = (meta.__my_meal_reviews__ ?? {}) as Record<string, { rating: number }>;
          for (const [mealId, entry] of Object.entries(map)) {
            if (!mealIdSet.has(mealId)) continue;
            if (!perMeal[mealId]) perMeal[mealId] = new Map();
            if (!perMeal[mealId].has(uid)) perMeal[mealId].set(uid, Number(entry.rating) || 0);
          }
        }
      }
    } catch { /* best-effort */ }
  }

  for (const [mealId, ratingMap] of Object.entries(perMeal)) {
    const ratings = Array.from(ratingMap.values());
    if (ratings.length === 0) continue;
    const sum = ratings.reduce((a, b) => a + b, 0);
    result[mealId] = { average: sum / ratings.length, count: ratings.length };
  }
  return result;
}
