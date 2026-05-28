// Shared normalizer for AI-authored recipes.
//
// The `build_recipe` AI tool (used by both the LocationChat assistant
// and the Add Recipe modal's "Create with AI" flow) emits a loosely
// structured recipe object. This module converts that raw tool output
// into a fully-formed `HomeMeal` that the Advanced recipe builder can
// hydrate from and that `createHomeMeal` can persist directly.

import type {
  HomeMeal,
  RecipeIngredient,
  RecipeIngredientGroup,
  RecipeNote,
  RecipeStepDetail,
} from '../contexts/ListsContext';

/** Shape the `build_recipe` tool emits — mirrors AdvancedRecipeState
 *  field-for-field, plus a flat `ingredients` shortcut for simple
 *  single-stage recipes. Normalized into a HomeMeal before use. */
export interface BuildRecipeInput {
  name?: string;
  summary?: string;
  cuisine?: string;
  course?: string[];
  difficulty?: 'Easy' | 'Medium' | 'Hard';
  prepTime?: number;
  cookTime?: number;
  chillTime?: number;
  servings?: number;
  yieldDescription?: string;
  /** Flat list — model may emit either this or ingredientGroups. */
  ingredients?: RecipeIngredient[];
  ingredientGroups?: RecipeIngredientGroup[];
  steps?: RecipeStepDetail[];
  equipment?: string[];
  tags?: string[];
  notes?: RecipeNote[];
}

/** Turn the tool's structured input into a complete HomeMeal that the
 *  Advanced builder can hydrate from via `fromHomeMeal()`. Dual-writes
 *  the rich → flat representations so any consumer that reads the flat
 *  `ingredients` / `steps` arrays still renders.
 *
 *  Permissive: accepts ingredients as either a flat array or a grouped
 *  array (or both — groups win). The only hard requirement is a
 *  non-empty name. Empty ingredient / step lists are fine — the recipe
 *  still renders and the user can refine it. Returns `null` only when
 *  there's literally nothing to show. */
export function buildRecipeInputToHomeMeal(input: BuildRecipeInput): HomeMeal | null {
  const name = (input.name || '').trim();
  if (!name) return null;

  // Ingredients: prefer explicit groups; otherwise wrap a flat list
  // into a single "Ingredients" group.
  let groups: RecipeIngredientGroup[] = [];
  if (Array.isArray(input.ingredientGroups) && input.ingredientGroups.length > 0) {
    groups = input.ingredientGroups
      .filter((g) => g && Array.isArray(g.ingredients))
      .map((g) => ({
        name: g.name || 'Ingredients',
        ingredients: g.ingredients
          .filter((i) => i && (i.name || '').trim())
          .map((i) => ({ name: i.name.trim(), amount: i.amount || '', unit: i.unit || '' })),
      }))
      .filter((g) => g.ingredients.length > 0);
  }
  if (groups.length === 0 && Array.isArray(input.ingredients) && input.ingredients.length > 0) {
    const flat = input.ingredients
      .filter((i) => i && (i.name || '').trim())
      .map((i) => ({ name: i.name.trim(), amount: i.amount || '', unit: i.unit || '' }));
    if (flat.length > 0) groups = [{ name: 'Ingredients', ingredients: flat }];
  }
  const flatIngredients: RecipeIngredient[] = groups.flatMap((g) => g.ingredients);

  const stepDetails: RecipeStepDetail[] = Array.isArray(input.steps)
    ? input.steps
        .filter((s) => s && (s.body || '').trim())
        .map((s) => ({
          title: s.title?.trim() || undefined,
          body: s.body.trim(),
          durationMin: typeof s.durationMin === 'number' && s.durationMin > 0 ? s.durationMin : undefined,
          tip: s.tip?.trim() || undefined,
        }))
    : [];
  const flatSteps = stepDetails.map((s) => s.body);

  const summary = (input.summary || '').trim();
  const today = new Date().toISOString().slice(0, 10);

  return {
    id: `ai-draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    summary: summary || undefined,
    description: summary,
    date: today,
    score: 0,
    wouldMakeAgain: false,
    isPublic: false,
    dishes: [],
    photos: [],
    tags: Array.isArray(input.tags) ? input.tags.filter((t) => typeof t === 'string' && t.trim()) : [],
    cuisine: input.cuisine || undefined,
    course: Array.isArray(input.course) ? input.course.filter((c) => typeof c === 'string' && c.trim()) : undefined,
    difficulty: input.difficulty,
    prepTime: typeof input.prepTime === 'number' && input.prepTime >= 0 ? input.prepTime : undefined,
    cookTime: typeof input.cookTime === 'number' && input.cookTime >= 0 ? input.cookTime : undefined,
    chillTime: typeof input.chillTime === 'number' && input.chillTime >= 0 ? input.chillTime : undefined,
    servings: typeof input.servings === 'number' && input.servings > 0 ? input.servings : undefined,
    yieldDescription: input.yieldDescription?.trim() || undefined,
    ingredientGroups: groups,
    ingredients: flatIngredients,
    stepDetails,
    steps: flatSteps,
    equipment: Array.isArray(input.equipment) ? input.equipment.filter((e) => typeof e === 'string' && e.trim()) : [],
    notes: Array.isArray(input.notes)
      ? input.notes.filter((n) => n && n.text && ['tip', 'makeAhead', 'substitution', 'general'].includes(n.type))
      : [],
    builderVersion: 'advanced',
    coverPhoto: undefined,
    createdAt: Date.now(),
  };
}
