import React, { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from 'react';
import { useAuth } from './AuthContext';
import {
  createRecipe as dbCreateRecipe,
  updateRecipe as dbUpdateRecipe,
  deleteRecipe as dbDeleteRecipe,
  getRecipe as dbGetRecipe,
  getUserRecipes,
  getPublicRecipes,
  getExpertRecipes,
  getFriendRecipes,
  upsertReview as dbUpsertReview,
  deleteReview as dbDeleteReview,
  getRecipeReviews,
  getUserReviews,
  type Recipe,
  type RecipeReview,
  type RecipeIngredient,
  type RecipeStep,
} from '../lib/supabase-recipes';
import { supabaseConfigured } from '../lib/supabase';
import { getFriends } from '../lib/supabase-community';

export type { Recipe, RecipeReview, RecipeIngredient, RecipeStep };

/* ── Context interface ── */

interface RecipesContextValue {
  // User's recipes
  myRecipes: Recipe[];
  createRecipe: (recipe: Omit<Recipe, 'id' | 'createdAt' | 'updatedAt'>) => Promise<Recipe | null>;
  updateRecipe: (id: string, updates: Partial<Omit<Recipe, 'id' | 'userId' | 'createdAt' | 'updatedAt'>>) => Promise<boolean>;
  deleteRecipe: (id: string) => Promise<void>;
  getRecipe: (id: string) => Recipe | undefined;
  refreshMyRecipes: () => Promise<void>;

  // Public / expert / friend recipes (fetched on demand)
  publicRecipes: Recipe[];
  expertRecipes: Recipe[];
  friendRecipes: Recipe[];
  fetchPublicRecipes: () => Promise<void>;
  fetchExpertRecipes: () => Promise<void>;
  fetchFriendRecipes: () => Promise<void>;

  // Reviews
  getReviewsForRecipe: (recipeId: string) => Promise<RecipeReview[]>;
  getMyReviews: () => Promise<RecipeReview[]>;
  upsertReview: (recipeId: string, data: { rating: number; notes: string; photo: string }) => Promise<RecipeReview | null>;
  deleteReview: (reviewId: string) => Promise<boolean>;

  // Modal state
  recipeModalOpen: boolean;
  recipeModalData: Recipe | null;
  openRecipeModal: (recipe?: Recipe) => void;
  closeRecipeModal: () => void;

  // Transient UI state — ingredient checkboxes keyed by a stable recipe key.
  // Lives only in memory so navigating away and back within a session
  // preserves the checkmarks; a hard refresh clears them.
  getCheckedIngredients: (recipeKey: string) => ReadonlySet<number>;
  toggleIngredientCheck: (recipeKey: string, idx: number) => void;
  clearIngredientChecks: (recipeKey: string) => void;

  // Same shape for step collapse: tapping a step in the directions list
  // collapses it down to just its number; tapping again expands. State
  // is in-memory so it survives in-session navigation but resets on
  // hard refresh.
  getCollapsedSteps: (recipeKey: string) => ReadonlySet<number>;
  toggleStepCollapse: (recipeKey: string, idx: number) => void;

  // Loading
  loading: boolean;
}

/* ── localStorage helpers ── */

const STORAGE_KEY_MY_RECIPES = 'gourmad-my-recipes';

function loadFromStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function saveToStorage(key: string, value: unknown) {
  // Swallow QuotaExceededError so it can't propagate out of setState updaters
  // and crash the page render. Cloud sync remains the source of truth.
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.warn(`[RecipesContext] saveToStorage(${key}) failed:`, err);
  }
}

/* ── Context ── */

// Stable empty-set sentinel so getCheckedIngredients returns referential
// equality across renders for recipes with no checks yet.
const EMPTY_INGREDIENT_SET: ReadonlySet<number> = new Set<number>();
const EMPTY_STEP_SET: ReadonlySet<number> = new Set<number>();

const RecipesContext = createContext<RecipesContextValue | null>(null);

export const RecipesProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const userIdRef = useRef(userId);
  userIdRef.current = userId;

  // User's own recipes — localStorage cached + cloud synced
  const [myRecipes, setMyRecipes] = useState<Recipe[]>(() => loadFromStorage(STORAGE_KEY_MY_RECIPES, []));
  const [loading, setLoading] = useState(false);

  // On-demand caches
  const [publicRecipes, setPublicRecipes] = useState<Recipe[]>([]);
  const [expertRecipes, setExpertRecipes] = useState<Recipe[]>([]);
  const [friendRecipes, setFriendRecipes] = useState<Recipe[]>([]);

  // Modal state
  const [recipeModalOpen, setRecipeModalOpen] = useState(false);
  const [recipeModalData, setRecipeModalData] = useState<Recipe | null>(null);

  // Transient ingredient checkbox state — preserved across navigation
  // within a session, never written to storage.
  const [checkedIngredients, setCheckedIngredients] = useState<Record<string, Set<number>>>({});
  const [collapsedSteps, setCollapsedSteps] = useState<Record<string, Set<number>>>({});

  // ── Load user's recipes from cloud on sign-in ──
  useEffect(() => {
    if (!userId || !supabaseConfigured) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      const cloudRecipes = await getUserRecipes(userId);
      if (cancelled) return;
      if (cloudRecipes.length > 0 || myRecipes.length === 0) {
        setMyRecipes(cloudRecipes);
        saveToStorage(STORAGE_KEY_MY_RECIPES, cloudRecipes);
      }
      setLoading(false);
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // ── CRUD methods ──

  const createRecipe = useCallback(async (
    recipe: Omit<Recipe, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<Recipe | null> => {
    const created = await dbCreateRecipe(recipe);
    if (created) {
      setMyRecipes((prev) => {
        const next = [created, ...prev];
        saveToStorage(STORAGE_KEY_MY_RECIPES, next);
        return next;
      });
    }
    return created;
  }, []);

  const updateRecipe = useCallback(async (
    id: string,
    updates: Partial<Omit<Recipe, 'id' | 'userId' | 'createdAt' | 'updatedAt'>>
  ): Promise<boolean> => {
    const ok = await dbUpdateRecipe(id, updates);
    if (ok) {
      setMyRecipes((prev) => {
        const next = prev.map((r) => r.id === id ? { ...r, ...updates, updatedAt: new Date().toISOString() } : r);
        saveToStorage(STORAGE_KEY_MY_RECIPES, next);
        return next;
      });
    }
    return ok;
  }, []);

  const deleteRecipe = useCallback(async (id: string): Promise<void> => {
    await dbDeleteRecipe(id);
    setMyRecipes((prev) => {
      const next = prev.filter((r) => r.id !== id);
      saveToStorage(STORAGE_KEY_MY_RECIPES, next);
      return next;
    });
  }, []);

  const getRecipe = useCallback((id: string): Recipe | undefined => {
    return myRecipes.find((r) => r.id === id)
      || publicRecipes.find((r) => r.id === id)
      || expertRecipes.find((r) => r.id === id)
      || friendRecipes.find((r) => r.id === id);
  }, [myRecipes, publicRecipes, expertRecipes, friendRecipes]);

  const refreshMyRecipes = useCallback(async () => {
    if (!userIdRef.current || !supabaseConfigured) return;
    const recipes = await getUserRecipes(userIdRef.current);
    setMyRecipes(recipes);
    saveToStorage(STORAGE_KEY_MY_RECIPES, recipes);
  }, []);

  // ── On-demand fetch methods ──
  // These feed the Discover "Recipes for you" rail, which only renders ~8
  // cards. Each recipe row carries a base64 cover photo, so over-fetching is
  // pure wasted download/decode — pull a small ranking pool, not 30 each. The
  // full /recipes-for-you page fetches its own larger set independently.
  const RAIL_POOL = 12;

  const fetchPublicRecipes = useCallback(async () => {
    const recipes = await getPublicRecipes(RAIL_POOL);
    setPublicRecipes(recipes);
  }, []);

  const fetchExpertRecipes = useCallback(async () => {
    const recipes = await getExpertRecipes(RAIL_POOL);
    setExpertRecipes(recipes);
  }, []);

  const fetchFriendRecipes = useCallback(async () => {
    if (!userIdRef.current) return;
    const friends = await getFriends(userIdRef.current);
    if (friends.length === 0) { setFriendRecipes([]); return; }
    const friendIds = friends.map((f) => f.friend_id);
    const recipes = await getFriendRecipes(friendIds, RAIL_POOL);
    setFriendRecipes(recipes);
  }, []);

  // ── Reviews ──

  const getReviewsForRecipe = useCallback(async (recipeId: string): Promise<RecipeReview[]> => {
    return getRecipeReviews(recipeId);
  }, []);

  const getMyReviews = useCallback(async (): Promise<RecipeReview[]> => {
    if (!userIdRef.current) return [];
    return getUserReviews(userIdRef.current);
  }, []);

  const upsertReview = useCallback(async (
    recipeId: string,
    data: { rating: number; notes: string; photo: string }
  ): Promise<RecipeReview | null> => {
    if (!userIdRef.current) return null;
    return dbUpsertReview(userIdRef.current, recipeId, data);
  }, []);

  const deleteReviewFn = useCallback(async (reviewId: string): Promise<boolean> => {
    return dbDeleteReview(reviewId);
  }, []);

  // ── Modal ──

  const openRecipeModal = useCallback((recipe?: Recipe) => {
    setRecipeModalData(recipe ?? null);
    setRecipeModalOpen(true);
  }, []);

  const closeRecipeModal = useCallback(() => {
    setRecipeModalOpen(false);
    setRecipeModalData(null);
  }, []);

  // ── Ingredient check state ──

  const getCheckedIngredients = useCallback(
    (recipeKey: string): ReadonlySet<number> => checkedIngredients[recipeKey] ?? EMPTY_INGREDIENT_SET,
    [checkedIngredients],
  );

  const toggleIngredientCheck = useCallback((recipeKey: string, idx: number) => {
    setCheckedIngredients((prev) => {
      const current = prev[recipeKey] ?? new Set<number>();
      const next = new Set(current);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return { ...prev, [recipeKey]: next };
    });
  }, []);

  const getCollapsedSteps = useCallback(
    (recipeKey: string): ReadonlySet<number> => collapsedSteps[recipeKey] ?? EMPTY_STEP_SET,
    [collapsedSteps],
  );

  const toggleStepCollapse = useCallback((recipeKey: string, idx: number) => {
    setCollapsedSteps((prev) => {
      const current = prev[recipeKey] ?? new Set<number>();
      const next = new Set(current);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return { ...prev, [recipeKey]: next };
    });
  }, []);

  const clearIngredientChecks = useCallback((recipeKey: string) => {
    setCheckedIngredients((prev) => {
      if (!(recipeKey in prev)) return prev;
      const next = { ...prev };
      delete next[recipeKey];
      return next;
    });
  }, []);

  // ── Provider value ──

  const value: RecipesContextValue = {
    myRecipes, createRecipe, updateRecipe, deleteRecipe, getRecipe, refreshMyRecipes,
    publicRecipes, expertRecipes, friendRecipes,
    fetchPublicRecipes, fetchExpertRecipes, fetchFriendRecipes,
    getReviewsForRecipe, getMyReviews, upsertReview, deleteReview: deleteReviewFn,
    recipeModalOpen, recipeModalData, openRecipeModal, closeRecipeModal,
    getCheckedIngredients, toggleIngredientCheck, clearIngredientChecks,
    getCollapsedSteps, toggleStepCollapse,
    loading,
  };

  return (
    <RecipesContext.Provider value={value}>
      {children}
    </RecipesContext.Provider>
  );
};

export function useRecipes(): RecipesContextValue {
  const ctx = useContext(RecipesContext);
  if (!ctx) throw new Error('useRecipes must be used within RecipesProvider');
  return ctx;
}
