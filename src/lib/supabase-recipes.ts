/**
 * Recipe CRUD and query functions — Supabase data layer.
 */
import { supabase, supabaseConfigured } from './supabase';
import { normalizeNutrition, type RecipeNutrition } from './nutrition';

/* ── Types ── */

export interface RecipeIngredient {
  name: string;
  amount: string;
  unit: string;
}

export interface RecipeStep {
  order: number;
  text: string;
}

export interface Recipe {
  id: string;
  userId: string;
  title: string;
  description: string;
  ingredients: RecipeIngredient[];
  steps: RecipeStep[];
  prepTimeMinutes: number | null;
  cookTimeMinutes: number | null;
  servings: number | null;
  difficulty: 'easy' | 'medium' | 'hard';
  cuisine: string;
  tags: string[];
  photos: string[];             // base64 or URLs
  isPublic: boolean;
  sourceType: 'user' | 'expert';
  linkedRestaurantId: string | null;
  linkedMealId: string | null;
  /** Per-serving nutrition (migration 090); absent or null until estimated. */
  nutrition?: RecipeNutrition | null;
  createdAt: string;
  updatedAt: string;
}

export interface RecipeReview {
  id: string;
  userId: string;
  recipeId: string;
  rating: number;
  notes: string;
  photo: string;
  createdAt: string;
  updatedAt: string;
}

/* ── Helpers ── */

/** Map a Supabase row to our Recipe type. */
function rowToRecipe(row: Record<string, unknown>): Recipe {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    title: row.title as string,
    description: row.description as string,
    ingredients: (row.ingredients as RecipeIngredient[]) || [],
    steps: (row.steps as RecipeStep[]) || [],
    prepTimeMinutes: (row.prep_time_minutes as number) ?? null,
    cookTimeMinutes: (row.cook_time_minutes as number) ?? null,
    servings: (row.servings as number) ?? null,
    difficulty: (row.difficulty as Recipe['difficulty']) || 'medium',
    cuisine: (row.cuisine as string) || '',
    tags: (row.tags as string[]) || [],
    photos: (row.photos as string[]) || [],
    isPublic: row.is_public as boolean,
    sourceType: (row.source_type as Recipe['sourceType']) || 'user',
    linkedRestaurantId: (row.linked_restaurant_id as string) || null,
    linkedMealId: (row.linked_meal_id as string) || null,
    nutrition: normalizeNutrition(row.nutrition),
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

/** Map a Supabase row to our RecipeReview type. */
function rowToReview(row: Record<string, unknown>): RecipeReview {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    recipeId: row.recipe_id as string,
    rating: Number(row.rating),
    notes: (row.notes as string) || '',
    photo: (row.photo as string) || '',
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

/** A stable content fingerprint for a recipe, independent of its row id.
 * Used to collapse rows that are the *same* recipe published more than once
 * (each publish inserts a fresh uuid, so an id-only dedupe misses them). */
function recipeContentKey(r: Recipe): string {
  return [
    r.userId,
    r.title.trim().toLowerCase(),
    r.cookTimeMinutes ?? '',
    r.prepTimeMinutes ?? '',
    (r.description || '').trim().toLowerCase(),
    r.ingredients.length,
    r.steps.length,
  ].join('|');
}

/** Collapse content-duplicate recipes, keeping the first occurrence in the
 * given order. Defensive against the duplicate rows already in the database;
 * the publish path should also avoid creating them. */
export function dedupeRecipes(recipes: Recipe[]): Recipe[] {
  const seen = new Set<string>();
  const out: Recipe[] = [];
  for (const r of recipes) {
    const key = recipeContentKey(r);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

/** Build a Supabase-compatible payload from a Recipe. */
function recipeToPayload(recipe: Omit<Recipe, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }) {
  return {
    ...(recipe.id ? { id: recipe.id } : {}),
    user_id: recipe.userId,
    title: recipe.title,
    description: recipe.description,
    ingredients: recipe.ingredients,
    steps: recipe.steps,
    prep_time_minutes: recipe.prepTimeMinutes,
    cook_time_minutes: recipe.cookTimeMinutes,
    servings: recipe.servings,
    difficulty: recipe.difficulty,
    cuisine: recipe.cuisine,
    tags: recipe.tags,
    photos: recipe.photos,
    is_public: recipe.isPublic,
    source_type: recipe.sourceType,
    linked_restaurant_id: recipe.linkedRestaurantId,
    linked_meal_id: recipe.linkedMealId,
    nutrition: recipe.nutrition ?? null,
    updated_at: new Date().toISOString(),
  };
}

/* ── Recipe CRUD ── */

/** Create a new recipe. Returns the created recipe or null. */
export async function createRecipe(
  recipe: Omit<Recipe, 'id' | 'createdAt' | 'updatedAt'>
): Promise<Recipe | null> {
  if (!supabaseConfigured) return null;
  try {
    const { data, error } = await supabase.from('recipes')
      .insert(recipeToPayload(recipe))
      .select('*')
      .single();
    if (error) { console.error('[Recipes] create error:', error); return null; }
    return rowToRecipe(data as Record<string, unknown>);
  } catch (err) { console.error('[Recipes] create exception:', err); return null; }
}

/** Update an existing recipe. Returns success. */
export async function updateRecipe(
  id: string,
  updates: Partial<Omit<Recipe, 'id' | 'userId' | 'createdAt' | 'updatedAt'>>
): Promise<boolean> {
  if (!supabaseConfigured) return false;
  try {
    const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (updates.title !== undefined) payload.title = updates.title;
    if (updates.description !== undefined) payload.description = updates.description;
    if (updates.ingredients !== undefined) payload.ingredients = updates.ingredients;
    if (updates.steps !== undefined) payload.steps = updates.steps;
    if (updates.prepTimeMinutes !== undefined) payload.prep_time_minutes = updates.prepTimeMinutes;
    if (updates.cookTimeMinutes !== undefined) payload.cook_time_minutes = updates.cookTimeMinutes;
    if (updates.servings !== undefined) payload.servings = updates.servings;
    if (updates.difficulty !== undefined) payload.difficulty = updates.difficulty;
    if (updates.cuisine !== undefined) payload.cuisine = updates.cuisine;
    if (updates.nutrition !== undefined) payload.nutrition = updates.nutrition;
    if (updates.tags !== undefined) payload.tags = updates.tags;
    if (updates.photos !== undefined) payload.photos = updates.photos;
    if (updates.isPublic !== undefined) payload.is_public = updates.isPublic;
    if (updates.sourceType !== undefined) payload.source_type = updates.sourceType;
    if (updates.linkedRestaurantId !== undefined) payload.linked_restaurant_id = updates.linkedRestaurantId;
    if (updates.linkedMealId !== undefined) payload.linked_meal_id = updates.linkedMealId;

    const { error } = await supabase.from('recipes')
      .update(payload).eq('id', id);
    if (error) { console.error('[Recipes] update error:', error); return false; }
    return true;
  } catch (err) { console.error('[Recipes] update exception:', err); return false; }
}

/** Delete a recipe by ID. */
export async function deleteRecipe(id: string): Promise<boolean> {
  if (!supabaseConfigured) return false;
  try {
    const { error } = await supabase.from('recipes').delete().eq('id', id);
    if (error) { console.error('[Recipes] delete error:', error); return false; }
    return true;
  } catch (err) { console.error('[Recipes] delete exception:', err); return false; }
}

/** Fetch a single recipe by ID. */
export async function getRecipe(id: string): Promise<Recipe | null> {
  if (!supabaseConfigured) return null;
  try {
    const { data, error } = await supabase.from('recipes')
      .select('*').eq('id', id).single();
    if (error || !data) return null;
    return rowToRecipe(data as Record<string, unknown>);
  } catch (err) { console.error('[Recipes] get exception:', err); return null; }
}

/* ── Recipe queries ── */

/** Fetch all recipes belonging to a user. */
export async function getUserRecipes(userId: string): Promise<Recipe[]> {
  if (!supabaseConfigured || !userId) return [];
  try {
    const { data, error } = await supabase.from('recipes')
      .select('*').eq('user_id', userId)
      .order('updated_at', { ascending: false });
    if (error) { console.error('[Recipes] getUserRecipes error:', error); return []; }
    return dedupeRecipes((data || []).map((r) => rowToRecipe(r as Record<string, unknown>)));
  } catch (err) { console.error('[Recipes] getUserRecipes exception:', err); return []; }
}

/** Fetch public recipes, optionally filtered by cuisine or tags. */
export async function getPublicRecipes(limit = 30): Promise<Recipe[]> {
  if (!supabaseConfigured) return [];
  try {
    const { data, error } = await supabase.from('recipes')
      .select('*').eq('is_public', true)
      .order('updated_at', { ascending: false }).limit(limit);
    if (error) { console.error('[Recipes] getPublic error:', error); return []; }
    return dedupeRecipes((data || []).map((r) => rowToRecipe(r as Record<string, unknown>)));
  } catch (err) { console.error('[Recipes] getPublic exception:', err); return []; }
}

/** Fetch expert-authored recipes. */
export async function getExpertRecipes(limit = 30): Promise<Recipe[]> {
  if (!supabaseConfigured) return [];
  try {
    const { data, error } = await supabase.from('recipes')
      .select('*').eq('source_type', 'expert').eq('is_public', true)
      .order('updated_at', { ascending: false }).limit(limit);
    if (error) { console.error('[Recipes] getExpert error:', error); return []; }
    return dedupeRecipes((data || []).map((r) => rowToRecipe(r as Record<string, unknown>)));
  } catch (err) { console.error('[Recipes] getExpert exception:', err); return []; }
}

/** Fetch public recipes from a list of friend user IDs. */
export async function getFriendRecipes(friendIds: string[], limit = 30): Promise<Recipe[]> {
  if (!supabaseConfigured || friendIds.length === 0) return [];
  try {
    const { data, error } = await supabase.from('recipes')
      .select('*').in('user_id', friendIds).eq('is_public', true)
      .order('updated_at', { ascending: false }).limit(limit);
    if (error) { console.error('[Recipes] getFriend error:', error); return []; }
    return dedupeRecipes((data || []).map((r) => rowToRecipe(r as Record<string, unknown>)));
  } catch (err) { console.error('[Recipes] getFriend exception:', err); return []; }
}

/* ── Recipe Review CRUD ── */

/** Create or update a review for a recipe. Upserts on (user_id, recipe_id). */
export async function upsertReview(
  userId: string,
  recipeId: string,
  data: { rating: number; notes: string; photo: string }
): Promise<RecipeReview | null> {
  if (!supabaseConfigured || !userId) return null;
  try {
    const { data: row, error } = await supabase.from('recipe_reviews')
      .upsert({
        user_id: userId,
        recipe_id: recipeId,
        rating: data.rating,
        notes: data.notes,
        photo: data.photo,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,recipe_id' })
      .select('*')
      .single();
    if (error) { console.error('[Reviews] upsert error:', error); return null; }
    return rowToReview(row as Record<string, unknown>);
  } catch (err) { console.error('[Reviews] upsert exception:', err); return null; }
}

/** Delete a review. */
export async function deleteReview(reviewId: string): Promise<boolean> {
  if (!supabaseConfigured) return false;
  try {
    const { error } = await supabase.from('recipe_reviews').delete().eq('id', reviewId);
    if (error) { console.error('[Reviews] delete error:', error); return false; }
    return true;
  } catch (err) { console.error('[Reviews] delete exception:', err); return false; }
}

/** Fetch all reviews for a recipe. */
export async function getRecipeReviews(recipeId: string): Promise<RecipeReview[]> {
  if (!supabaseConfigured) return [];
  try {
    const { data, error } = await supabase.from('recipe_reviews')
      .select('*').eq('recipe_id', recipeId)
      .order('created_at', { ascending: false });
    if (error) { console.error('[Reviews] getForRecipe error:', error); return []; }
    return (data || []).map((r) => rowToReview(r as Record<string, unknown>));
  } catch (err) { console.error('[Reviews] getForRecipe exception:', err); return []; }
}

/** Fetch all reviews by a user. */
export async function getUserReviews(userId: string): Promise<RecipeReview[]> {
  if (!supabaseConfigured || !userId) return [];
  try {
    const { data, error } = await supabase.from('recipe_reviews')
      .select('*').eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (error) { console.error('[Reviews] getUserReviews error:', error); return []; }
    return (data || []).map((r) => rowToReview(r as Record<string, unknown>));
  } catch (err) { console.error('[Reviews] getUserReviews exception:', err); return []; }
}

/* ── Recipe / home-meal likes + comments ──────────────────────────────────
   A lightweight social layer for recipes and friend home meals, mirroring the
   restaurant rating likes/comments (supabase-community.ts) but keyed by a
   string `target_id` so it works for both formal recipe UUIDs and home-meal
   ids like `meal-1781029`. Backed by recipe_likes / recipe_comments /
   recipe_comment_likes. Every function degrades to empty / no-op if those
   tables don't exist yet (so the app keeps working before the migration). */

export interface RecipeComment {
  id: string;
  user_id: string;
  target_id: string;
  text: string;
  created_at: string;
  parent_id?: string | null;
  like_count?: number;
  liked_by_me?: boolean;
}

/** Toggle the caller's like on a recipe/meal. Returns true on success. */
export async function toggleRecipeLike(userId: string, targetId: string): Promise<boolean> {
  if (!supabaseConfigured || !userId || !targetId) return false;
  try {
    const { data } = await supabase.from('recipe_likes')
      .select('id').eq('user_id', userId).eq('target_id', targetId).maybeSingle();
    if (data) await supabase.from('recipe_likes').delete().eq('id', (data as { id: string }).id);
    else await supabase.from('recipe_likes').insert({ user_id: userId, target_id: targetId });
    return true;
  } catch { return false; }
}

/** Like counts + which the caller liked, for a batch of recipe/meal ids. */
export async function getRecipeLikes(
  userId: string | null,
  targetIds: string[],
): Promise<{ likes: Record<string, number>; userLiked: Set<string> }> {
  if (!supabaseConfigured || targetIds.length === 0) return { likes: {}, userLiked: new Set() };
  try {
    const { data } = await supabase.from('recipe_likes')
      .select('target_id, user_id').in('target_id', targetIds);
    const likes: Record<string, number> = {};
    const userLiked = new Set<string>();
    (data || []).forEach((l: { target_id: string; user_id: string }) => {
      likes[l.target_id] = (likes[l.target_id] || 0) + 1;
      if (userId && l.user_id === userId) userLiked.add(l.target_id);
    });
    return { likes, userLiked };
  } catch { return { likes: {}, userLiked: new Set() }; }
}

/** Add a top-level comment (or a reply when parentId is set). */
export async function addRecipeComment(
  userId: string,
  targetId: string,
  text: string,
  parentId: string | null = null,
): Promise<boolean> {
  if (!supabaseConfigured || !userId || !text.trim()) return false;
  try {
    const payload: Record<string, unknown> = { user_id: userId, target_id: targetId, text: text.trim() };
    if (parentId) payload.parent_id = parentId;
    const { error } = await supabase.from('recipe_comments').insert(payload);
    return !error;
  } catch { return false; }
}

/** All comments for a recipe/meal (top-level + replies) with per-comment
 *  like counts and whether the caller liked each. */
export async function getRecipeComments(targetId: string, currentUserId?: string | null): Promise<RecipeComment[]> {
  if (!supabaseConfigured || !targetId) return [];
  try {
    const { data, error } = await supabase.from('recipe_comments')
      .select('*').eq('target_id', targetId).order('created_at', { ascending: true });
    if (error) return [];
    const comments = (data || []) as RecipeComment[];
    if (comments.length === 0) return comments;
    const ids = comments.map((c) => c.id);
    try {
      const { data: likeRows } = await supabase.from('recipe_comment_likes')
        .select('comment_id, user_id').in('comment_id', ids);
      const counts: Record<string, number> = {};
      const mine = new Set<string>();
      (likeRows || []).forEach((row: { comment_id: string; user_id: string }) => {
        counts[row.comment_id] = (counts[row.comment_id] || 0) + 1;
        if (currentUserId && row.user_id === currentUserId) mine.add(row.comment_id);
      });
      return comments.map((c) => ({ ...c, like_count: counts[c.id] || 0, liked_by_me: mine.has(c.id) }));
    } catch { return comments; }
  } catch { return []; }
}

/** Comment counts for a batch of recipe/meal ids (for feed badges). */
export async function getRecipeCommentCounts(targetIds: string[]): Promise<Record<string, number>> {
  if (!supabaseConfigured || targetIds.length === 0) return {};
  try {
    const { data } = await supabase.from('recipe_comments').select('target_id').in('target_id', targetIds);
    const counts: Record<string, number> = {};
    (data || []).forEach((c: { target_id: string }) => { counts[c.target_id] = (counts[c.target_id] || 0) + 1; });
    return counts;
  } catch { return {}; }
}

/** Toggle the caller's like on a single comment. Returns the new liked state. */
export async function toggleRecipeCommentLike(userId: string, commentId: string): Promise<boolean | null> {
  if (!supabaseConfigured || !userId) return null;
  try {
    const { data } = await supabase.from('recipe_comment_likes')
      .select('id').eq('user_id', userId).eq('comment_id', commentId).maybeSingle();
    if (data) { await supabase.from('recipe_comment_likes').delete().eq('id', (data as { id: string }).id); return false; }
    await supabase.from('recipe_comment_likes').insert({ user_id: userId, comment_id: commentId });
    return true;
  } catch { return null; }
}

/** Delete one of the caller's own comments (and its replies). */
export async function deleteRecipeComment(commentId: string): Promise<boolean> {
  if (!supabaseConfigured) return false;
  try {
    // Replies first — without a DB-level cascade, a deleted parent stranded
    // its replies as rows that never rendered but still inflated the count
    // badges. RLS may keep OTHER users' replies; the thread renders those
    // orphans as top-level comments so counts still agree.
    await supabase.from('recipe_comments').delete().eq('parent_id', commentId);
    const { error } = await supabase.from('recipe_comments').delete().eq('id', commentId);
    return !error;
  } catch { return false; }
}
