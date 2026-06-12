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
  generateRecipe,
  editRecipeIngredient,
} from './build-recipe-client';

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
