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

/** Fetch every review for a single home meal from the table + meta fallback. */
export async function getHomeMealReviews(mealId: string): Promise<HomeMealReview[]> {
  if (!supabaseConfigured || !mealId) return [];
  const results: HomeMealReview[] = [];
  // Try the dedicated table.
  try {
    const { data, error } = await supabase.from('recipe_reviews')
      .select('*')
      .eq('recipe_id', mealId)
      .order('updated_at', { ascending: false });
    if (!error && data) {
      for (const r of data) results.push(rowToHomeMealReview(r as Record<string, unknown>));
    }
  } catch { /* table may not exist */ }
  return results;
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

/** Batch-fetch review summaries for multiple meal IDs in a single query. */
export async function getReviewSummariesBatch(
  mealIds: string[],
): Promise<Record<string, { average: number; count: number }>> {
  const result: Record<string, { average: number; count: number }> = {};
  if (!supabaseConfigured || mealIds.length === 0) return result;
  try {
    const { data, error } = await supabase.from('recipe_reviews')
      .select('recipe_id, rating')
      .in('recipe_id', mealIds);
    if (error || !data) return result;
    // Group by meal id and compute averages.
    const groups: Record<string, number[]> = {};
    for (const row of data) {
      const id = row.recipe_id as string;
      if (!groups[id]) groups[id] = [];
      groups[id].push(Number(row.rating) || 0);
    }
    for (const [id, ratings] of Object.entries(groups)) {
      const sum = ratings.reduce((a, b) => a + b, 0);
      result[id] = { average: sum / ratings.length, count: ratings.length };
    }
  } catch { /* table may not exist */ }
  return result;
}
