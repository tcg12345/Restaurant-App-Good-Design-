import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { HomeMeal } from '../contexts/ListsContext';

// build-recipe-client transitively imports the Supabase client (for auth
// headers); stub the boundary so tests run without env/config.
vi.mock('./api-base', () => ({
  apiUrl: (name: string) => `https://test.local/${name}`,
  apiHeaders: async () => ({ 'Content-Type': 'application/json' }),
}));

import {
  readRecipeStream,
  readIdeasStream,
  generateRecipe,
  editRecipeIngredient,
  combineRecipes,
  homeMealToBuildInput,
  type RecipeIdea,
} from './build-recipe-client';
import { buildRecipeInputToHomeMeal } from './recipe-from-ai';

/** Build an Anthropic-style SSE Response from a list of events. */
function sseResponse(events: Array<Record<string, unknown>>): Response {
  const text = events
    .map((e) => `event: ${(e as { type?: string }).type ?? 'message'}\ndata: ${JSON.stringify(e)}\n\n`)
    .join('');
  return new Response(text, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

function toolUseEvents(name: string, json: string, stopReason = 'tool_use') {
  // Split the JSON into a few partial_json deltas like the real stream does.
  const third = Math.max(1, Math.floor(json.length / 3));
  const parts = [json.slice(0, third), json.slice(third, 2 * third), json.slice(2 * third)].filter(Boolean);
  return [
    { type: 'message_start', message: { id: 'msg_1' } },
    { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', name, input: {} } },
    ...parts.map((p) => ({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'input_json_delta', partial_json: p },
    })),
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: stopReason } },
    { type: 'message_stop' },
  ];
}

describe('readRecipeStream', () => {
  it('assembles a build_recipe tool call into a recipe', async () => {
    const recipe = { name: 'Grilled Cheese', servings: 1, steps: [{ body: 'Toast it.' }] };
    const res = sseResponse(toolUseEvents('build_recipe', JSON.stringify(recipe)));
    const out = await readRecipeStream(res);
    expect(out.error).toBeUndefined();
    expect(out.declineReason).toBeUndefined();
    expect(out.recipe).toEqual(recipe);
  });

  it('surfaces a decline_change tool call as a decline reason, not a recipe', async () => {
    const res = sseResponse(
      toolUseEvents('decline_change', JSON.stringify({ reason: 'Eggs are the structure of a meringue — without them there is no dish.' })),
    );
    const out = await readRecipeStream(res);
    expect(out.recipe).toBeUndefined();
    expect(out.error).toBeUndefined();
    expect(out.declineReason).toContain('meringue');
  });

  it('falls back to a generic decline reason when the decline JSON is malformed', async () => {
    const res = sseResponse(toolUseEvents('decline_change', '{"reason": "unterminated'));
    const out = await readRecipeStream(res);
    expect(out.recipe).toBeUndefined();
    expect(out.declineReason).toBeTruthy();
  });

  it('reports truncation when the stream stops at max_tokens mid-JSON', async () => {
    const res = sseResponse(toolUseEvents('build_recipe', '{"name": "Croissants", "steps": [', 'max_tokens'));
    const out = await readRecipeStream(res);
    expect(out.recipe).toBeUndefined();
    expect(out.error).toMatch(/too long/i);
  });

  it('surfaces stream error events', async () => {
    const res = sseResponse([
      { type: 'message_start', message: { id: 'msg_1' } },
      { type: 'error', error: { message: 'Overloaded' } },
    ]);
    const out = await readRecipeStream(res);
    expect(out.error).toBe('Overloaded');
  });

  it('keeps the LAST complete block when the model emits build_recipe twice', async () => {
    // A self-correcting model can re-emit the tool in one message; the old
    // per-name concatenation produced `{...}{...}` and failed to parse.
    const first = { name: 'Draft One', steps: [{ body: 'Old.' }] };
    const second = { name: 'Draft Two', steps: [{ body: 'New.' }] };
    const firstEvents = toolUseEvents('build_recipe', JSON.stringify(first));
    const secondEvents = toolUseEvents('build_recipe', JSON.stringify(second));
    // Merge: message_start + first block, then second block + message end.
    const res = sseResponse([
      ...firstEvents.slice(0, firstEvents.length - 2),
      ...secondEvents.slice(1),
    ]);
    const out = await readRecipeStream(res);
    expect(out.error).toBeUndefined();
    expect(out.recipe).toEqual(second);
  });
});

describe('request payloads', () => {
  let lastBody: Record<string, unknown> | null = null;

  beforeEach(() => {
    lastBody = null;
    vi.stubGlobal('fetch', async (_url: unknown, init?: RequestInit) => {
      lastBody = JSON.parse(String(init?.body ?? '{}'));
      return sseResponse(
        toolUseEvents('build_recipe', JSON.stringify({ name: 'Test Dish', steps: [{ body: 'Cook.' }] })),
      );
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('generateRecipe sends difficulty and structured constraints', async () => {
    const res = await generateRecipe('A weeknight pasta', undefined, {
      difficulty: 'Easy',
      constraints: { totalTimeMax: 30, servings: 4, course: 'Dinner', dietary: ['Vegetarian'] },
    });
    expect(res.ok).toBe(true);
    expect(res.meal?.name).toBe('Test Dish');
    expect(lastBody).toMatchObject({
      prompt: 'A weeknight pasta',
      difficulty: 'Easy',
      constraints: { totalTimeMax: 30, servings: 4, course: 'Dinner', dietary: ['Vegetarian'] },
    });
  });

  it('generateRecipe omits constraints when none are set', async () => {
    await generateRecipe('Brownies');
    expect(lastBody).toEqual({ prompt: 'Brownies' });
  });

  it('editRecipeIngredient sends the ingredient edit and the current recipe', async () => {
    const current = {
      id: 'draft-1',
      name: 'Chicken Fried Rice',
      ingredients: [{ name: 'chicken thighs', amount: '2', unit: '' }],
      steps: ['Cook it.'],
    } as unknown as HomeMeal;
    const res = await editRecipeIngredient(current, {
      action: 'substitute',
      ingredient: 'chicken thighs',
      replacement: 'tofu',
    });
    expect(res.ok).toBe(true);
    expect(res.meal?.id).toBe('draft-1'); // merge preserves identity
    expect(lastBody).toMatchObject({
      ingredientEdit: { action: 'substitute', ingredient: 'chicken thighs', replacement: 'tofu' },
      current: { name: 'Chicken Fried Rice' },
    });
  });

  it('editRecipeIngredient surfaces a decline without touching the meal', async () => {
    vi.stubGlobal('fetch', async () =>
      sseResponse(toolUseEvents('decline_change', JSON.stringify({ reason: 'That swap would break the dish.' }))),
    );
    const current = { id: 'draft-2', name: 'Meringue', steps: [] } as unknown as HomeMeal;
    const res = await editRecipeIngredient(current, { action: 'remove', ingredient: 'egg whites' });
    expect(res.ok).toBe(false);
    expect(res.declined).toBe(true);
    expect(res.declineReason).toContain('break the dish');
    expect(res.meal).toBeUndefined();
  });
});

/* ── Ideas + combining ─────────────────────────────────────────────── */

const IDEA: RecipeIdea = {
  title: 'Miso-Butter Corn Pasta',
  blurb: 'Sweet corn, salty miso butter, one pot.',
  cuisine: 'Japanese-Italian',
  totalTimeMin: 25,
  difficulty: 'Easy',
};

function ideasJson(ideas: unknown[]): string {
  return JSON.stringify({ ideas });
}

describe('readIdeasStream', () => {
  it('assembles a full batch from the suggest_recipe_ideas tool', async () => {
    const batch = Array.from({ length: 8 }, (_, i) => ({ ...IDEA, title: `Idea ${i}` }));
    const out = await readIdeasStream(sseResponse(toolUseEvents('suggest_recipe_ideas', ideasJson(batch))));
    expect(out.error).toBeUndefined();
    expect(out.ideas).toHaveLength(8);
    expect(out.ideas![3].title).toBe('Idea 3');
  });

  it('drops a malformed row without losing the batch', async () => {
    const batch = [IDEA, { blurb: 'no title' }, { ...IDEA, title: 'Second', totalTimeMin: 'soon' }];
    const out = await readIdeasStream(sseResponse(toolUseEvents('suggest_recipe_ideas', ideasJson(batch))));
    expect(out.ideas).toHaveLength(2);
    // Junk time falls back to a sane default rather than NaN.
    expect(out.ideas![1].totalTimeMin).toBe(30);
  });

  it('errors, not throws, when the stream carries no ideas tool at all', async () => {
    const out = await readIdeasStream(sseResponse(toolUseEvents('build_recipe', '{"name":"x"}')));
    expect(out.ideas).toBeUndefined();
    expect(out.error).toBeTruthy();
  });
});

describe('homeMealToBuildInput', () => {
  it('round-trips a meal through the model-facing shape without losing the cookable core', () => {
    const meal = buildRecipeInputToHomeMeal({
      name: 'Test Galette',
      summary: 'Flaky and honest.',
      cuisine: 'French',
      difficulty: 'Medium',
      prepTime: 30,
      cookTime: 45,
      servings: 6,
      ingredients: ['2 cups flour', '1 stick butter'],
      steps: [{ body: 'Make the dough.' }, { body: 'Bake it.' }],
      tags: ['Baking'],
    } as never);
    const input = homeMealToBuildInput(meal);
    const back = buildRecipeInputToHomeMeal(input as never);
    expect(back.name).toBe('Test Galette');
    expect(back.ingredients).toEqual(meal.ingredients);
    expect(back.steps).toEqual(meal.steps);
    expect(back.prepTime).toBe(30);
    expect(back.cookTime).toBe(45);
    expect(back.servings).toBe(6);
  });
});

describe('combineRecipes', () => {
  const RECIPE_JSON = JSON.stringify({
    name: 'Corn Galette',
    cuisine: 'French',
    prepTime: 20,
    cookTime: 40,
    servings: 4,
    ingredients: ['corn', 'dough'],
    steps: [{ body: 'Assemble.' }, { body: 'Bake.' }],
  });

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse(toolUseEvents('build_recipe', RECIPE_JSON))));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('attaches combinedFrom for recipe sources that carry a ref', async () => {
    const out = await combineRecipes([
      { kind: 'recipe', recipe: { name: 'A' } as never, ref: { id: 'a1', ownerId: 'u1', source: 'homeMeal', title: 'Recipe A' } },
      { kind: 'recipe', recipe: { name: 'B' } as never, ref: { id: 'b1', ownerId: 'u2', source: 'recipe', title: 'Recipe B' } },
    ]);
    expect(out.ok).toBe(true);
    expect(out.meal!.combinedFrom).toEqual([
      { id: 'a1', ownerId: 'u1', source: 'homeMeal', title: 'Recipe A' },
      { id: 'b1', ownerId: 'u2', source: 'recipe', title: 'Recipe B' },
    ]);
    // AI provenance rides along from the normalizer.
    expect(out.meal!.createdWithAi).toBe(true);
  });

  it('attaches NO combinedFrom for idea-only combines — nothing real to link', async () => {
    const out = await combineRecipes([
      { kind: 'idea', idea: IDEA },
      { kind: 'idea', idea: { ...IDEA, title: 'Charred Corn Salad' } },
    ], { notes: 'the char from the salad' });
    expect(out.ok).toBe(true);
    expect(out.meal!.combinedFrom).toBeUndefined();
    // The request carried the sources + notes in the combine envelope.
    const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(call[1].body as string);
    expect(body.combine.sources).toHaveLength(2);
    expect(body.combine.notes).toBe('the char from the salad');
  });
});
