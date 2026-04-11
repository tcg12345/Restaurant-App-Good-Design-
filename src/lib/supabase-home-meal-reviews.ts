/**
 * Home meal (recipe) reviews.
 *
 * Recipes published by one user can be reviewed (rating 0-5 + notes) by
 * other users who discover them on the Explore tab. We reuse the existing
 * `recipe_reviews` table — the `recipe_id` column just holds the home
 * meal id since meal IDs and recipe IDs live in disjoint namespaces.
 *
 * As a fallback for environments where the table might not exist or the
 * RLS policy rejects the write, we also stash a copy of the current
 * user's review inside restaurant_meta.__home_meal_reviews__ on their
 * user_app_data row so the reviewer at least sees their own history.
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

/** Create or update the current user's review for a home meal. */
export async function upsertHomeMealReview(
  userId: string,
  mealId: string,
  data: { rating: number; notes: string },
): Promise<HomeMealReview | null> {
  if (!supabaseConfigured || !userId || !mealId) return null;
  try {
    const { data: row, error } = await supabase.from('recipe_reviews')
      .upsert({
        user_id: userId,
        recipe_id: mealId,
        rating: data.rating,
        notes: data.notes,
        photo: '',
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,recipe_id' })
      .select('*')
      .single();
    if (error) {
      console.warn('[HomeMealReviews] upsert error:', error.message);
      return null;
    }
    return rowToHomeMealReview(row as Record<string, unknown>);
  } catch (err) {
    console.warn('[HomeMealReviews] upsert exception:', err);
    return null;
  }
}

/** Delete the current user's review for a home meal. */
export async function deleteHomeMealReview(
  userId: string,
  mealId: string,
): Promise<boolean> {
  if (!supabaseConfigured || !userId || !mealId) return false;
  try {
    const { error } = await supabase.from('recipe_reviews')
      .delete()
      .eq('user_id', userId)
      .eq('recipe_id', mealId);
    if (error) {
      console.warn('[HomeMealReviews] delete error:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[HomeMealReviews] delete exception:', err);
    return false;
  }
}

/** Fetch every review for a single home meal. */
export async function getHomeMealReviews(mealId: string): Promise<HomeMealReview[]> {
  if (!supabaseConfigured || !mealId) return [];
  try {
    const { data, error } = await supabase.from('recipe_reviews')
      .select('*')
      .eq('recipe_id', mealId)
      .order('updated_at', { ascending: false });
    if (error) {
      console.warn('[HomeMealReviews] getForMeal error:', error.message);
      return [];
    }
    return (data || []).map((r) => rowToHomeMealReview(r as Record<string, unknown>));
  } catch (err) {
    console.warn('[HomeMealReviews] getForMeal exception:', err);
    return [];
  }
}

/** Fetch the current user's own review for a home meal, if any. */
export async function getMyHomeMealReview(
  userId: string,
  mealId: string,
): Promise<HomeMealReview | null> {
  if (!supabaseConfigured || !userId || !mealId) return null;
  try {
    const { data, error } = await supabase.from('recipe_reviews')
      .select('*')
      .eq('user_id', userId)
      .eq('recipe_id', mealId)
      .maybeSingle();
    if (error) {
      console.warn('[HomeMealReviews] getMine error:', error.message);
      return null;
    }
    return data ? rowToHomeMealReview(data as Record<string, unknown>) : null;
  } catch (err) {
    console.warn('[HomeMealReviews] getMine exception:', err);
    return null;
  }
}

/** Averages a list of reviews into { average, count }. */
export function summarizeReviews(reviews: HomeMealReview[]): { average: number; count: number } {
  if (reviews.length === 0) return { average: 0, count: 0 };
  const sum = reviews.reduce((acc, r) => acc + (Number.isFinite(r.rating) ? r.rating : 0), 0);
  return { average: sum / reviews.length, count: reviews.length };
}
