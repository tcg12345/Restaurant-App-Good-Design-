/**
 * Recipe CRUD and query functions — Supabase data layer.
 */
import { supabase, supabaseConfigured } from './supabase';

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
    return (data || []).map((r) => rowToRecipe(r as Record<string, unknown>));
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
    return (data || []).map((r) => rowToRecipe(r as Record<string, unknown>));
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
    return (data || []).map((r) => rowToRecipe(r as Record<string, unknown>));
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
    return (data || []).map((r) => rowToRecipe(r as Record<string, unknown>));
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
