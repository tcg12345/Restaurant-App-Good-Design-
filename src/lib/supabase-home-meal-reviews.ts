/**
 * Home meal (recipe) reviews.
 *
 * Recipes published by one user can be reviewed (rating 0-5 + notes) by
 * other users who discover them on the Explore tab. We try the existing
 * `recipe_reviews` table first, and fall back to storing the reviewer's
 * own review inside their `user_app_data.restaurant_meta.__my_meal_reviews__`
 * when the table doesn't exist or RLS blocks the write. This dual-write
 * approach mirrors the pattern used for home meals themselves.
 *
 * Meta WRITES go through ListsContext (see MetaReviewStash below) — this
 * module never writes the shared restaurant_meta column directly.
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

// recipe_reviews.recipe_id is a UUID column. Local home-meal ids like
// "meal-1777659500373-zohzwnt" aren't UUIDs, and PostgREST returns 400 for
// them. Use this guard before any supabase call that filters by recipe_id.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: string): boolean => UUID_RE.test(v);

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

// Cross-user meta scan. user_app_data is owner-only under RLS (migration
// 013), so other reviewers' rows are only reachable through the SECURITY
// DEFINER RPC from migration 037, which extracts just the requested meals'
// entries from each user's __my_meal_reviews__.
type MetaReviewRow = { user_id: string; meal_id: string; rating: number; notes: string; updated_at: string };

async function fetchMetaReviews(mealIds: string[], scanUserIds: string[]): Promise<MetaReviewRow[]> {
  // Non-UUID ids would 400 the whole call (the RPC param is uuid[]).
  const scanIds = scanUserIds.filter(isUuid);
  if (mealIds.length === 0 || scanIds.length === 0) return [];
  try {
    const { data, error } = await supabase.rpc('get_meal_reviews_meta', {
      meal_ids: mealIds,
      scan_user_ids: scanIds,
    });
    if (!error && Array.isArray(data)) return data as MetaReviewRow[];
    console.warn('[HomeMealReviews] meta RPC error, falling back to direct scan:', error?.message);
  } catch (err) {
    console.warn('[HomeMealReviews] meta RPC exception, falling back to direct scan:', err);
  }
  // Fallback for when migration 037 hasn't been run yet: the direct select
  // returns at most the caller's own row under RLS — the old behavior.
  try {
    const { data, error } = await supabase.from('user_app_data')
      .select('user_id, restaurant_meta')
      .in('user_id', scanIds);
    if (error || !data) return [];
    const mealIdSet = new Set(mealIds);
    const rows: MetaReviewRow[] = [];
    for (const row of data) {
      const uid = (row as { user_id: string }).user_id;
      const meta = (row.restaurant_meta ?? {}) as Record<string, unknown>;
      const map = (meta.__my_meal_reviews__ ?? {}) as MetaReviewMap;
      if (typeof map !== 'object' || Array.isArray(map)) continue;
      for (const [mealId, entry] of Object.entries(map)) {
        if (!mealIdSet.has(mealId) || !entry || typeof entry !== 'object') continue;
        rows.push({
          user_id: uid,
          meal_id: mealId,
          rating: Number(entry.rating) || 0,
          notes: entry.notes || '',
          updated_at: entry.updatedAt || '',
        });
      }
    }
    return rows;
  } catch { return []; }
}

/** How the meta fallback gets WRITTEN. restaurant_meta is shared with
 *  __home_meals__ / __visit_history__ / __tombstones__ and owned by
 *  ListsContext, which pushes the whole JSONB from its state. The previous
 *  version here did its own read-modify-write of the entire column: racing
 *  a ListsContext sync lost one side's write, and even without a race its
 *  fresh-DB-read blob could be staler than local state — resurrecting
 *  deleted meals/visit history (ListsContext records a prior clobber bug of
 *  exactly this shape). Callers now pass their context meta + stashMetaKey
 *  so every restaurant_meta write serializes through the one owner. */
export interface MetaReviewStash {
  /** ListsContext's restaurantMeta state — the authoritative merged copy,
   *  NOT a fresh DB read. */
  meta: Record<string, unknown>;
  /** ListsContext's stashMetaKey — merges one reserved key into
   *  restaurant_meta via the context's serialized state + sync path. */
  stashMetaKey: (key: string, value: unknown) => void;
}

const reviewMapFrom = (meta: Record<string, unknown>): MetaReviewMap => {
  const raw = meta.__my_meal_reviews__;
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...(raw as MetaReviewMap) } : {};
};

function saveMyMetaReview(
  mealId: string,
  review: { rating: number; notes: string },
  stash: MetaReviewStash,
): void {
  const map = reviewMapFrom(stash.meta);
  map[mealId] = { rating: review.rating, notes: review.notes, updatedAt: new Date().toISOString() };
  stash.stashMetaKey('__my_meal_reviews__', map);
}

// ── Public API ──

/** Create or update the current user's review for a home meal. `stash`
 *  carries ListsContext's meta + stashMetaKey — the meta fallback writes
 *  through it (see MetaReviewStash), never directly at the column. */
export async function upsertHomeMealReview(
  userId: string,
  mealId: string,
  data: { rating: number; notes: string },
  stash: MetaReviewStash,
): Promise<HomeMealReview | null> {
  if (!supabaseConfigured || !userId || !mealId) return null;

  const now = new Date().toISOString();
  const canUseTable = isUuid(mealId);

  // Try the dedicated table first (only for UUID-shaped ids — the column is uuid).
  if (canUseTable) try {
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
      saveMyMetaReview(mealId, data, stash);
      return rowToHomeMealReview(row as Record<string, unknown>);
    }
    console.warn('[HomeMealReviews] table upsert failed, falling back to meta:', error?.message);
  } catch (err) {
    console.warn('[HomeMealReviews] table upsert exception, falling back to meta:', err);
  }

  // Fallback: store in the reviewer's own restaurant_meta (via ListsContext,
  // which persists locally at once and syncs the column when cloud-ready).
  saveMyMetaReview(mealId, data, stash);
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

/** Delete the current user's review for a home meal. */
export async function deleteHomeMealReview(
  userId: string,
  mealId: string,
  stash: MetaReviewStash,
): Promise<boolean> {
  if (!supabaseConfigured || !userId || !mealId) return false;
  if (isUuid(mealId)) try {
    await supabase.from('recipe_reviews')
      .delete()
      .eq('user_id', userId)
      .eq('recipe_id', mealId);
  } catch { /* best-effort */ }
  // Also clear from meta — through ListsContext, same as the save path.
  const map = reviewMapFrom(stash.meta);
  if (map[mealId]) {
    delete map[mealId];
    stash.stashMetaKey('__my_meal_reviews__', map);
  }
  return true;
}

/** Fetch every review for a single home meal from the table + meta fallback.
 *  Pass `scanUserIds` to also read `restaurant_meta.__my_meal_reviews__[mealId]`
 *  from those users' rows (via the migration-037 RPC — see fetchMetaReviews);
 *  this is how reviews that were persisted via the meta path become visible
 *  to other users. */
export async function getHomeMealReviews(
  mealId: string,
  scanUserIds: string[] = [],
): Promise<HomeMealReview[]> {
  if (!supabaseConfigured || !mealId) return [];
  const byUser = new Map<string, HomeMealReview>();

  // 1. Dedicated table (preferred — wins on duplicates). Skip when the id
  //    isn't UUID-shaped — the column is uuid and PostgREST returns 400.
  if (isUuid(mealId)) try {
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

  // 2. Meta fallback — the scan users' __my_meal_reviews__ entries for this
  //    meal, fetched through the migration-037 RPC.
  if (scanUserIds.length > 0) {
    for (const row of await fetchMetaReviews([mealId], scanUserIds)) {
      if (!row.user_id || byUser.has(row.user_id)) continue; // table entry wins
      byUser.set(row.user_id, {
        id: `meta-${row.user_id}-${mealId}`,
        userId: row.user_id,
        mealId,
        rating: Number(row.rating) || 0,
        notes: row.notes || '',
        createdAt: row.updated_at || '',
        updatedAt: row.updated_at || '',
      });
    }
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

  // Try the dedicated table — only for UUID-shaped ids (column is uuid).
  if (isUuid(mealId)) try {
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

  // recipe_reviews.recipe_id is a UUID column — non-UUID ids (e.g. local
  // "meal-…" ids that haven't been published) make the .in() filter return a
  // 400 from PostgREST. Filter to UUID-shaped ids before querying.
  const tableMealIds = mealIds.filter(isUuid);

  // 1. Table.
  if (tableMealIds.length > 0) try {
    const { data, error } = await supabase.from('recipe_reviews')
      .select('recipe_id, user_id, rating')
      .in('recipe_id', tableMealIds);
    if (!error && data) {
      for (const row of data) {
        const meal = row.recipe_id as string;
        const user = row.user_id as string;
        if (!perMeal[meal]) perMeal[meal] = new Map();
        perMeal[meal].set(user, Number(row.rating) || 0);
      }
    }
  } catch { /* table may not exist */ }

  // 2. Meta fallback — the scan users' __my_meal_reviews__ entries for the
  //    requested meals, fetched through the migration-037 RPC.
  if (scanUserIds.length > 0) {
    for (const row of await fetchMetaReviews(mealIds, scanUserIds)) {
      if (!row.user_id || !row.meal_id) continue;
      if (!perMeal[row.meal_id]) perMeal[row.meal_id] = new Map();
      if (!perMeal[row.meal_id].has(row.user_id)) {
        perMeal[row.meal_id].set(row.user_id, Number(row.rating) || 0);
      }
    }
  }

  for (const [mealId, ratingMap] of Object.entries(perMeal)) {
    const ratings = Array.from(ratingMap.values());
    if (ratings.length === 0) continue;
    const sum = ratings.reduce((a, b) => a + b, 0);
    result[mealId] = { average: sum / ratings.length, count: ratings.length };
  }
  return result;
}
