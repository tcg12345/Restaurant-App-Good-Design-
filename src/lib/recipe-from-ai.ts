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
  RecipeStepGroup,
} from '../contexts/ListsContext';

/** Shape the `build_recipe` tool emits — mirrors AdvancedRecipeState
 *  field-for-field, plus a flat `ingredients` shortcut for simple
 *  single-stage recipes. Normalized into a HomeMeal before use. */
export interface BuildRecipeInput {
  name?: string;
  summary?: string;
  /** Longer "story" paragraph for the recipe page body (distinct from the
   *  one-line summary). */
  introParagraph?: string;
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
  /** Flat method — model may emit either this or stepGroups. */
  steps?: RecipeStepDetail[];
  stepGroups?: RecipeStepGroup[];
  equipment?: string[];
  tags?: string[];
  notes?: RecipeNote[];
}

/** Clean one raw AI step into a RecipeStepDetail, or null if it's empty. */
function normalizeStep(s: RecipeStepDetail | undefined): RecipeStepDetail | null {
  if (!s || !(s.body || '').trim()) return null;
  return {
    title: s.title?.trim() || undefined,
    body: s.body.trim(),
    durationMin: typeof s.durationMin === 'number' && s.durationMin > 0 ? s.durationMin : undefined,
    tip: s.tip?.trim() || undefined,
  };
}

/** Normalize the method into rich grouped sections + the flat fallbacks.
 *  Prefers `stepGroups` (multi-component dishes); otherwise wraps the flat
 *  `steps` list. `groups` is left empty for a simple single-flow recipe
 *  (no real sections) so renderers fall back to the flat list cleanly. */
function normalizeMethod(input: BuildRecipeInput): {
  stepGroups: RecipeStepGroup[];
  stepDetails: RecipeStepDetail[];
  steps: string[];
} {
  let groups: RecipeStepGroup[] = [];
  if (Array.isArray(input.stepGroups) && input.stepGroups.length > 0) {
    groups = input.stepGroups
      .filter((g) => g && Array.isArray(g.steps))
      .map((g) => ({
        name: (g.name || '').trim(),
        steps: g.steps.map(normalizeStep).filter((s): s is RecipeStepDetail => s !== null),
      }))
      .filter((g) => g.steps.length > 0);
  }
  // A lone unnamed section isn't a real grouping — treat it as flat.
  const isMeaningfulGrouping =
    groups.length > 1 || (groups.length === 1 && !!groups[0].name);

  const flatDetails: RecipeStepDetail[] = isMeaningfulGrouping
    ? groups.flatMap((g) => g.steps)
    : (Array.isArray(input.steps)
        ? input.steps.map(normalizeStep).filter((s): s is RecipeStepDetail => s !== null)
        : groups.flatMap((g) => g.steps));

  return {
    stepGroups: isMeaningfulGrouping ? groups : [],
    stepDetails: flatDetails,
    steps: flatDetails.map((s) => s.body),
  };
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

  const { stepGroups, stepDetails, steps: flatSteps } = normalizeMethod(input);

  const summary = (input.summary || '').trim();
  const introParagraph = (input.introParagraph || '').trim();
  const today = new Date().toISOString().slice(0, 10);

  return {
    id: `ai-draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    summary: summary || undefined,
    introParagraph: introParagraph || undefined,
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
    stepGroups: stepGroups.length > 0 ? stepGroups : undefined,
    stepDetails,
    steps: flatSteps,
    equipment: Array.isArray(input.equipment) ? input.equipment.filter((e) => typeof e === 'string' && e.trim()) : [],
    notes: Array.isArray(input.notes)
      ? input.notes.filter((n) => n && n.text && ['tip', 'makeAhead', 'substitution', 'general'].includes(n.type))
      : [],
    builderVersion: 'advanced',
    createdWithAi: true,
    coverPhoto: undefined,
    createdAt: Date.now(),
  };
}

/** Apply an `edit_recipe_draft` partial onto an existing HomeMeal,
 *  returning a NEW HomeMeal. Preserves identity-bearing fields (id,
 *  createdAt, coverPhoto, photos, builderVersion, isPublic, dishes,
 *  source attribution) and replaces any provided field with its
 *  normalized form using the same rules `buildRecipeInputToHomeMeal`
 *  applies. Array fields are full replacements when present —
 *  matching the AI's "emit the full revised list" contract. */
export function mergeRecipeEdit(current: HomeMeal, input: BuildRecipeInput): HomeMeal {
  const out: HomeMeal = { ...current };
  const has = (k: keyof BuildRecipeInput) =>
    Object.prototype.hasOwnProperty.call(input, k) && input[k] !== undefined;

  if (has('name')) {
    const name = (input.name || '').trim();
    if (name) out.name = name;
  }
  if (has('summary')) {
    const summary = (input.summary || '').trim();
    out.summary = summary || undefined;
    out.description = summary;
  }
  if (has('introParagraph')) {
    out.introParagraph = (input.introParagraph || '').trim() || undefined;
  }
  if (has('cuisine')) {
    const cuisine = (input.cuisine || '').trim();
    out.cuisine = cuisine || undefined;
  }
  if (has('course')) {
    out.course = Array.isArray(input.course)
      ? input.course.filter((c) => typeof c === 'string' && c.trim())
      : undefined;
  }
  if (has('difficulty')) out.difficulty = input.difficulty;
  if (has('prepTime')) {
    out.prepTime = typeof input.prepTime === 'number' && input.prepTime >= 0
      ? input.prepTime
      : undefined;
  }
  if (has('cookTime')) {
    out.cookTime = typeof input.cookTime === 'number' && input.cookTime >= 0
      ? input.cookTime
      : undefined;
  }
  if (has('chillTime')) {
    out.chillTime = typeof input.chillTime === 'number' && input.chillTime >= 0
      ? input.chillTime
      : undefined;
  }
  if (has('servings')) {
    out.servings = typeof input.servings === 'number' && input.servings > 0
      ? input.servings
      : undefined;
  }
  if (has('yieldDescription')) {
    const yd = input.yieldDescription?.trim();
    out.yieldDescription = yd || undefined;
  }

  // Ingredients: if either form is supplied, rebuild both rich groups
  // and the flat array so all renderers stay in sync.
  if (has('ingredientGroups') || has('ingredients')) {
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
    out.ingredientGroups = groups;
    out.ingredients = groups.flatMap((g) => g.ingredients);
  }

  if (has('steps') || has('stepGroups')) {
    const { stepGroups, stepDetails, steps } = normalizeMethod(input);
    out.stepGroups = stepGroups.length > 0 ? stepGroups : undefined;
    out.stepDetails = stepDetails;
    out.steps = steps;
  }

  if (has('equipment')) {
    out.equipment = Array.isArray(input.equipment)
      ? input.equipment.filter((e) => typeof e === 'string' && e.trim())
      : [];
  }
  if (has('tags')) {
    out.tags = Array.isArray(input.tags)
      ? input.tags.filter((t) => typeof t === 'string' && t.trim())
      : [];
  }
  if (has('notes')) {
    out.notes = Array.isArray(input.notes)
      ? input.notes.filter((n) => n && n.text && ['tip', 'makeAhead', 'substitution', 'general'].includes(n.type))
      : [];
  }

  return out;
}

/** List the top-level fields the AI provided in an `edit_recipe_draft`
 *  call — used to label the tool_result message ("Updated draft: name,
 *  steps, notes"). Order matches what a human would read. */
export function changedFieldsInEdit(input: BuildRecipeInput): string[] {
  const order: Array<keyof BuildRecipeInput> = [
    'name', 'summary', 'introParagraph', 'cuisine', 'course', 'difficulty',
    'prepTime', 'cookTime', 'chillTime', 'servings', 'yieldDescription',
    'ingredients', 'ingredientGroups', 'steps', 'stepGroups', 'equipment', 'tags', 'notes',
  ];
  return order.filter((k) =>
    Object.prototype.hasOwnProperty.call(input, k) && input[k] !== undefined,
  ) as string[];
}
