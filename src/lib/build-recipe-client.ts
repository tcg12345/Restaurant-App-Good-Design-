// Client for the build-recipe Supabase Edge Function. Sends a single
// free-text prompt (create), an instruction + current recipe (refine),
// or a single-ingredient remove/substitute request (which the AI may
// decline) and gets back one fully-formed recipe object, normalized
// into a HomeMeal ready for the Advanced builder / publish.

import type { HomeMeal, CombinedFromRef } from '../contexts/ListsContext';
import { buildRecipeInputToHomeMeal, mergeRecipeEdit, type BuildRecipeInput } from './recipe-from-ai';
import { normalizeNutrition, nutritionForModel, type RecipeNutrition } from './nutrition';
import { apiUrl, apiHeaders, readApiError, type ApiErrorCode } from './api-base';

const FUNCTION_URL = apiUrl('build-recipe');

export interface GenerateRecipeResult {
  ok: boolean;
  /** Present when ok — a HomeMeal seeded with the AI's recipe. */
  meal?: HomeMeal;
  /** The raw tool input the AI emitted — useful when the caller needs
   *  to round-trip the recipe back to the model (chat history). */
  recipe?: BuildRecipeInput;
  /** Present when !ok — a user-facing error message. */
  error?: string;
  /** Why the server refused, when it did (paywall routing). */
  code?: ApiErrorCode;
  resetsAt?: string | null;
}

/** Optional structured guidelines for `generateRecipe`. Sent as explicit
 *  hard requirements (not prose) so the model designs around them. */
export interface RecipeConstraints {
  /** Max total minutes — prep + cook + ALL passive time. */
  totalTimeMax?: number;
  servings?: number;
  course?: string;
  dietary?: string[];
}

/** Streaming progress: characters of tool JSON received so far. */
export type ProgressCallback = (chars: number) => void;

export interface GenerateRecipeOptions {
  /** Called as the tool JSON streams in (see lib/gen-progress). */
  onProgress?: ProgressCallback;
  difficulty?: 'Easy' | 'Medium' | 'Hard';
  constraints?: RecipeConstraints;
}

/** A single-ingredient edit the user requested from the draft preview. */
export interface IngredientEdit {
  action: 'remove' | 'substitute';
  /** The ingredient (as displayed) to remove or replace. */
  ingredient: string;
  /** Optional replacement for `substitute`; blank lets the AI choose. */
  replacement?: string;
}

export interface IngredientEditResult extends GenerateRecipeResult {
  /** True when the AI judged the change would compromise the dish and
   *  left the recipe untouched. `declineReason` says why (user-facing). */
  declined?: boolean;
  declineReason?: string;
}

/** Consume the proxied Anthropic SSE. The response is a single tool_use
 *  whose JSON input is delivered across many `input_json_delta` events;
 *  accumulate the partial_json fragments per tool block and parse once
 *  the stream ends. Streaming is what keeps the Edge function under the
 *  gateway timeout for long Opus generations.
 *
 *  Two tools can arrive: `build_recipe` (a recipe object) or — in the
 *  ingredient-edit mode only — `decline_change` ({ reason }) when the
 *  model judged the change would wreck the dish.
 *
 *  Exported for tests. */
export async function readRecipeStream(
  res: Response,
  onProgress?: ProgressCallback,
): Promise<{ recipe?: BuildRecipeInput; declineReason?: string; nutrition?: unknown; error?: string; code?: ApiErrorCode; resetsAt?: string | null }> {
  const assembled = await readToolStreams(res, onProgress);
  if (assembled.error) return { error: assembled.error };
  const { toolJson, toolJsonOpen, stopReason } = assembled;

  // The model declined the change — surface its reason verbatim. Fall back
  // to the in-progress buffer when the block never closed (truncation).
  const declineJson = toolJson['decline_change'] || toolJsonOpen['decline_change'];
  if (declineJson) {
    try {
      const parsed = JSON.parse(declineJson) as { reason?: string };
      return { declineReason: (parsed.reason || '').trim() || "That change would compromise the recipe, so I left it as is." };
    } catch {
      return { declineReason: "That change would compromise the recipe, so I left it as is." };
    }
  }

  // The nutrition-estimate mode answers with its own small tool.
  const nutritionJson = toolJson['estimate_nutrition'] || toolJsonOpen['estimate_nutrition'];
  if (nutritionJson) {
    try { return { nutrition: JSON.parse(nutritionJson) as unknown }; } catch { return { error: "I couldn't work out the nutrition for this one. Try again." }; }
  }

  const recipeJson = toolJson['build_recipe'] || toolJsonOpen['build_recipe'] || '';
  const truncated = stopReason === 'max_tokens';
  if (truncated && !recipeJson) {
    return { error: 'The recipe was too long to finish. Try a slightly simpler request.' };
  }
  try {
    const recipe = recipeJson ? (JSON.parse(recipeJson) as BuildRecipeInput) : undefined;
    if (!recipe) return { error: "I couldn't generate that recipe. Try rephrasing your request." };
    return { recipe };
  } catch {
    return {
      error: truncated
        ? 'The recipe was too long to finish. Try a slightly simpler request.'
        : "I couldn't generate that recipe. Try rephrasing your request.",
    };
  }
}

/** The raw per-tool JSON assembly under both readers: every complete
 *  block by tool name, the in-progress buffers (for truncation
 *  fallbacks), and the stop reason. */
async function readToolStreams(res: Response, onProgress?: ProgressCallback): Promise<{
  toolJson: Record<string, string>;
  toolJsonOpen: Record<string, string>;
  stopReason?: string;
  error?: string;
  /** Why the server refused, when it did (paywall routing). */
  code?: ApiErrorCode;
  resetsAt?: string | null;
}> {
  const empty = { toolJson: {}, toolJsonOpen: {} };
  if (!res.body) return { ...empty, error: 'No response body.' };
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  // JSON accumulated per tool name. Anthropic streams one content block
  // at a time: content_block_start names the tool, then input_json_delta
  // events carry its input. Track which block is open so each fragment
  // lands in the right buffer. A model can emit the SAME tool more than
  // once in one message (a self-correcting retry) — concatenating the
  // blocks produced `{...}{...}` that failed to parse, so we keep the
  // LAST COMPLETE block per name (in-progress buffer resets per block).
  const toolJson: Record<string, string> = {};      // last complete block per tool
  const toolJsonOpen: Record<string, string> = {};  // in-progress block buffers
  let openTool = '';
  let stopReason: string | undefined;
  let streamError: string | undefined;

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let blankIdx: number;
      while ((blankIdx = buffer.indexOf('\n\n')) !== -1) {
        const chunk = buffer.slice(0, blankIdx);
        buffer = buffer.slice(blankIdx + 2);

        let dataPayload = '';
        for (const line of chunk.split('\n')) {
          if (line.startsWith('data:')) {
            dataPayload += (dataPayload ? '\n' : '') + line.slice(5).trimStart();
          }
        }
        if (!dataPayload || dataPayload === '[DONE]') continue;

        let event: {
          type?: string;
          content_block?: { type?: string; name?: string };
          delta?: { type?: string; partial_json?: string; stop_reason?: string };
          error?: { message?: string };
        };
        try {
          event = JSON.parse(dataPayload);
        } catch {
          continue;
        }

        if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
          openTool = event.content_block.name || 'build_recipe';
          toolJsonOpen[openTool] = '';
        } else if (event.type === 'content_block_delta' && event.delta?.type === 'input_json_delta') {
          const name = openTool || 'build_recipe';
          toolJsonOpen[name] = (toolJsonOpen[name] ?? '') + (event.delta.partial_json ?? '');
          // Progress is the running size of the block being written — the
          // one signal of "how far along" a streamed generation has.
          onProgress?.(toolJsonOpen[name].length);
        } else if (event.type === 'content_block_stop') {
          if (openTool) toolJson[openTool] = toolJsonOpen[openTool] ?? '';
          openTool = '';
        } else if (event.type === 'message_delta' && event.delta?.stop_reason) {
          stopReason = event.delta.stop_reason;
        } else if (event.type === 'error') {
          streamError = event.error?.message || 'Streaming error';
        }
      }
    }
  } catch (err) {
    if ((err as { name?: string })?.name === 'AbortError') return { ...empty, error: 'Cancelled.' };
    return { ...empty, error: 'The connection dropped while writing the recipe. Try again.' };
  } finally {
    try { await reader.cancel(); } catch { /* ignore */ }
  }

  if (streamError) return { ...empty, error: streamError };
  return { toolJson, toolJsonOpen, stopReason };
}

/** POST to the build-recipe function and parse the response (SSE on success,
 *  JSON error otherwise). Shared by create + refine + ingredient edit. */
async function postRecipe(
  payload: Record<string, unknown>,
  signal?: AbortSignal,
  onProgress?: ProgressCallback,
): Promise<{ recipe?: BuildRecipeInput; declineReason?: string; nutrition?: unknown; error?: string; code?: ApiErrorCode; resetsAt?: string | null }> {
  let res: Response;
  try {
    res = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: await apiHeaders(),
      body: JSON.stringify(payload),
      signal,
    });
  } catch (err) {
    if ((err as { name?: string })?.name === 'AbortError') return { error: 'Cancelled.' };
    return { error: 'Network error — check your connection and try again.' };
  }
  if (!res.ok || !res.body) {
    const e = await readApiError(res);
    return { error: e.message, code: e.code, resetsAt: e.resetsAt };
  }
  return readRecipeStream(res, onProgress);
}

/**
 * Generate a recipe from a natural-language prompt plus optional
 * structured guidelines (difficulty / time / servings / course /
 * dietary). Resolves with a HomeMeal on success or a friendly error
 * message on failure. Never throws — the caller can render `error`
 * directly.
 */
export async function generateRecipe(
  prompt: string,
  signal?: AbortSignal,
  options?: GenerateRecipeOptions,
): Promise<GenerateRecipeResult> {
  const payload: Record<string, unknown> = { prompt };
  if (options?.difficulty) payload.difficulty = options.difficulty;
  if (options?.constraints && Object.keys(options.constraints).length > 0) {
    payload.constraints = options.constraints;
  }
  const { recipe, error, code, resetsAt } = await postRecipe(payload, signal, options?.onProgress);
  if (error) return { ok: false, error, code, resetsAt };
  const meal = recipe ? buildRecipeInputToHomeMeal(recipe) : null;
  if (!meal) return { ok: false, error: "I couldn't generate that recipe. Try rephrasing your request." };
  return { ok: true, meal, recipe };
}

/** Compact BuildRecipeInput view of a HomeMeal — what we hand the model
 *  as the "current recipe" to revise, and as a combine SOURCE. Exported
 *  for the combine flows (and tests); the refine/edit paths above use it
 *  privately. */
export function homeMealToBuildInput(meal: HomeMeal): BuildRecipeInput {
  return {
    name: meal.name,
    summary: meal.summary || meal.description || undefined,
    introParagraph: meal.introParagraph || undefined,
    cuisine: meal.cuisine || undefined,
    course: meal.course,
    difficulty: meal.difficulty,
    prepTime: meal.prepTime,
    cookTime: meal.cookTime,
    chillTime: meal.chillTime,
    servings: meal.servings,
    yieldDescription: meal.yieldDescription,
    ingredientGroups: meal.ingredientGroups && meal.ingredientGroups.length > 0 ? meal.ingredientGroups : undefined,
    ingredients: (!meal.ingredientGroups || meal.ingredientGroups.length === 0) ? meal.ingredients : undefined,
    // Hand the model grouped sections when the recipe has them so an AI
    // refine preserves (and can extend) the section structure; otherwise
    // send the flat step list.
    stepGroups: meal.stepGroups && meal.stepGroups.length > 0 ? meal.stepGroups : undefined,
    steps: (!meal.stepGroups || meal.stepGroups.length === 0)
      ? (meal.stepDetails && meal.stepDetails.length > 0
          ? meal.stepDetails
          : (meal.steps || []).map((body) => ({ body })))
      : undefined,
    equipment: meal.equipment,
    tags: meal.tags,
    notes: meal.notes,
    nutrition: nutritionForModel(meal.nutrition),
  };
}

export interface NutritionEstimateResult {
  ok: boolean;
  nutrition?: RecipeNutrition;
  error?: string;
  code?: ApiErrorCode;
  resetsAt?: string | null;
}

/**
 * Estimate per-serving nutrition for a recipe that has none — hand-written
 * ones, older imports. Pro only (the server refuses otherwise). Never
 * throws.
 */
export async function estimateNutrition(meal: HomeMeal, signal?: AbortSignal): Promise<NutritionEstimateResult> {
  const { nutrition, error, code, resetsAt } = await postRecipe({ nutritionFor: homeMealToBuildInput(meal) }, signal);
  if (error) return { ok: false, error, code, resetsAt };
  const clean = normalizeNutrition(nutrition, 'ai');
  if (!clean) return { ok: false, error: "I couldn't work out the nutrition for this one. Try again." };
  return { ok: true, nutrition: clean };
}

/**
 * Refine an existing recipe with a free-text instruction ("make it
 * spicier", "swap walnuts for pecans"). The AI returns the full
 * revised recipe; we merge it back onto the current meal so its id,
 * cover photo, and saved photos are preserved. Never throws.
 */
export async function refineRecipe(
  current: HomeMeal,
  instruction: string,
  signal?: AbortSignal,
): Promise<GenerateRecipeResult> {
  const { recipe, error, code, resetsAt } = await postRecipe(
    { instruction, current: homeMealToBuildInput(current) },
    signal,
  );
  if (error) return { ok: false, error, code, resetsAt };
  if (!recipe) return { ok: false, error: "I couldn't update that recipe. Try rephrasing." };
  // The model returns the full revised recipe — merge over the current
  // meal so identity-bearing fields (id, coverPhoto, photos) survive.
  const meal = mergeRecipeEdit(current, recipe);
  return { ok: true, meal, recipe };
}

/**
 * Remove or substitute ONE ingredient in an existing draft. Unlike
 * `refineRecipe`, the AI is allowed to refuse: when the change would
 * compromise the dish's authenticity or quality it declines, the recipe
 * is left untouched, and `declined` + `declineReason` explain why.
 * Never throws.
 */
export async function editRecipeIngredient(
  current: HomeMeal,
  edit: IngredientEdit,
  signal?: AbortSignal,
): Promise<IngredientEditResult> {
  const { recipe, declineReason, error, code, resetsAt } = await postRecipe(
    {
      ingredientEdit: {
        action: edit.action,
        ingredient: edit.ingredient,
        replacement: edit.replacement || undefined,
      },
      current: homeMealToBuildInput(current),
    },
    signal,
  );
  if (error) return { ok: false, error, code, resetsAt };
  if (declineReason) return { ok: false, declined: true, declineReason };
  if (!recipe) return { ok: false, error: "I couldn't update that recipe. Try again." };
  const meal = mergeRecipeEdit(current, recipe);
  return { ok: true, meal, recipe };
}

/* ── Ideas + combining ─────────────────────────────────────────────── */

/** One brainstormed dish — a title and a sales pitch, never a recipe. */
export interface RecipeIdea {
  title: string;
  blurb: string;
  cuisine: string;
  totalTimeMin: number;
  difficulty: 'Easy' | 'Medium' | 'Hard';
}

export interface RecipeIdeasResult {
  ok: boolean;
  ideas?: RecipeIdea[];
  error?: string;
  /** Why the server refused, when it did (paywall routing). */
  code?: ApiErrorCode;
  resetsAt?: string | null;
}

/** Normalize one raw idea from the model; null drops the row. A batch
 *  with a malformed entry should lose the entry, not the batch. */
function normalizeIdea(raw: unknown): RecipeIdea | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const title = typeof r.title === 'string' ? r.title.trim() : '';
  if (!title) return null;
  const blurb = typeof r.blurb === 'string' ? r.blurb.trim().slice(0, 200) : '';
  const cuisine = typeof r.cuisine === 'string' ? r.cuisine.trim().slice(0, 40) : '';
  const t = Number(r.totalTimeMin);
  const difficulty = r.difficulty === 'Easy' || r.difficulty === 'Medium' || r.difficulty === 'Hard'
    ? r.difficulty
    : 'Medium';
  return {
    title: title.slice(0, 120),
    blurb,
    cuisine,
    totalTimeMin: Number.isFinite(t) && t > 0 ? Math.round(t) : 30,
    difficulty,
  };
}

/**
 * Brainstorm ~8 recipe ideas for a mood + guidelines. `avoidTitles`
 * carries everything already shown so "More ideas" never repeats.
 * Never throws.
 */
export async function generateRecipeIdeas(
  prompt: string,
  opts?: {
    constraints?: RecipeConstraints;
    difficulty?: 'Easy' | 'Medium' | 'Hard';
    avoidTitles?: string[];
    signal?: AbortSignal;
    onProgress?: ProgressCallback;
  },
): Promise<RecipeIdeasResult> {
  const payload: Record<string, unknown> = { ideasPrompt: prompt };
  if (opts?.difficulty) payload.difficulty = opts.difficulty;
  if (opts?.constraints && Object.keys(opts.constraints).length > 0) payload.constraints = opts.constraints;
  if (opts?.avoidTitles && opts.avoidTitles.length > 0) payload.avoidTitles = opts.avoidTitles.slice(-40);
  const parsed = await postIdeas(payload, opts?.signal, opts?.onProgress);
  if (parsed.error) return { ok: false, error: parsed.error, code: parsed.code, resetsAt: parsed.resetsAt };
  return { ok: true, ideas: parsed.ideas };
}

/** POST an ideas request and assemble the suggest_recipe_ideas payload
 *  from the stream. Split from postRecipe because the tool differs. */
async function postIdeas(
  payload: Record<string, unknown>,
  signal?: AbortSignal,
  onProgress?: ProgressCallback,
): Promise<{ ideas?: RecipeIdea[]; error?: string; code?: ApiErrorCode; resetsAt?: string | null }> {
  let res: Response;
  try {
    res = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: await apiHeaders(),
      body: JSON.stringify(payload),
      signal,
    });
  } catch (err) {
    if ((err as { name?: string })?.name === 'AbortError') return { error: 'Cancelled.' };
    return { error: 'Network error — check your connection and try again.' };
  }
  if (!res.ok || !res.body) {
    const e = await readApiError(res);
    return { error: e.message, code: e.code, resetsAt: e.resetsAt };
  }
  return readIdeasStream(res, onProgress);
}

/** Assemble the suggest_recipe_ideas tool input from the SSE stream.
 *  Exported for tests, like readRecipeStream. */
export async function readIdeasStream(
  res: Response,
  onProgress?: ProgressCallback,
): Promise<{ ideas?: RecipeIdea[]; error?: string; code?: ApiErrorCode; resetsAt?: string | null }> {
  const assembled = await readToolStreams(res, onProgress);
  if (assembled.error) return { error: assembled.error };
  const json = assembled.toolJson['suggest_recipe_ideas'] || assembled.toolJsonOpen['suggest_recipe_ideas'] || '';
  if (!json) return { error: "I couldn't come up with ideas just now. Try again." };
  try {
    const parsed = JSON.parse(json) as { ideas?: unknown[] };
    const ideas = (Array.isArray(parsed.ideas) ? parsed.ideas : [])
      .map(normalizeIdea)
      .filter((i): i is RecipeIdea => i !== null);
    if (ideas.length === 0) return { error: "I couldn't come up with ideas just now. Try again." };
    return { ideas };
  } catch {
    return { error: "I couldn't come up with ideas just now. Try again." };
  }
}

/** Where a combined recipe came from — the provenance the recipe page
 *  links. The canonical type lives with the data model. */
export type CombinedSourceRef = CombinedFromRef;

export type CombineSource =
  | { kind: 'idea'; idea: RecipeIdea }
  | { kind: 'recipe'; recipe: BuildRecipeInput; ref?: CombinedSourceRef };

/**
 * Merge 2–3 sources (ideas and/or full recipes) into one new recipe.
 * The returned meal carries `combinedFrom` for every recipe source that
 * supplied a ref — idea sources link nothing (there is nothing real to
 * link) — and `createdWithAi` rides along from the normalizer as usual.
 * Never throws.
 */
export async function combineRecipes(
  sources: CombineSource[],
  opts?: {
    notes?: string;
    constraints?: RecipeConstraints;
    difficulty?: 'Easy' | 'Medium' | 'Hard';
    signal?: AbortSignal;
    onProgress?: ProgressCallback;
  },
): Promise<GenerateRecipeResult> {
  const payload: Record<string, unknown> = {
    combine: {
      sources: sources.map((s) =>
        s.kind === 'recipe' ? { kind: 'recipe', recipe: s.recipe } : { kind: 'idea', idea: s.idea }),
      ...(opts?.notes?.trim() ? { notes: opts.notes.trim() } : {}),
    },
  };
  if (opts?.difficulty) payload.difficulty = opts.difficulty;
  if (opts?.constraints && Object.keys(opts.constraints).length > 0) payload.constraints = opts.constraints;
  const { recipe, error, code, resetsAt } = await postRecipe(payload, opts?.signal, opts?.onProgress);
  if (error) return { ok: false, error, code, resetsAt };
  const meal = recipe ? buildRecipeInputToHomeMeal(recipe) : null;
  if (!meal) return { ok: false, error: "I couldn't combine those. Try rephrasing what you want from each." };
  const refs = sources
    .filter((s): s is Extract<CombineSource, { kind: 'recipe' }> => s.kind === 'recipe')
    .map((s) => s.ref)
    .filter((r): r is CombinedSourceRef => !!r);
  if (refs.length > 0) meal.combinedFrom = refs;
  return { ok: true, meal, recipe };
}

/** A formal recipes-table row as a combine source. The row's flat shape
 *  (string ingredients/steps, split minute fields) maps 1:1 onto the
 *  model-facing input; body-less rows still combine fine on title +
 *  description. */
export function formalRecipeToBuildInput(r: {
  title: string;
  description?: string;
  ingredients?: Array<{ name: string; amount?: string; unit?: string }>;
  steps?: string[];
  prepTimeMinutes?: number;
  cookTimeMinutes?: number;
  servings?: number;
  difficulty?: string;
  cuisine?: string;
  tags?: string[];
}): BuildRecipeInput {
  return {
    name: r.title,
    summary: r.description || undefined,
    cuisine: r.cuisine || undefined,
    difficulty: (['Easy', 'Medium', 'Hard'].includes(r.difficulty || '') ? r.difficulty : undefined) as BuildRecipeInput['difficulty'],
    prepTime: r.prepTimeMinutes || undefined,
    cookTime: r.cookTimeMinutes || undefined,
    servings: r.servings || undefined,
    ingredients: r.ingredients && r.ingredients.length > 0
      ? r.ingredients.map((i) => ({ name: i.name, amount: i.amount ?? '', unit: i.unit ?? '' }))
      : undefined,
    steps: r.steps && r.steps.length > 0 ? r.steps.map((body) => ({ body })) : undefined,
    tags: r.tags && r.tags.length > 0 ? r.tags : undefined,
  };
}
