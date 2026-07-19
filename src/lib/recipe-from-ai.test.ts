import { describe, it, expect } from 'vitest';
import { buildRecipeInputToHomeMeal, type BuildRecipeInput } from './recipe-from-ai';

describe('buildRecipeInputToHomeMeal', () => {
  it('coerces numeric scalars the model emits where strings belong', () => {
    // Models sometimes emit numbers ("name": 42) — `(42 || '').trim()`
    // used to throw and take the whole draft down.
    const input = {
      name: 42,
      summary: 7,
      ingredients: [{ name: 100, amount: 2, unit: 'g' }],
      steps: [{ body: 12345 }],
    } as unknown as BuildRecipeInput;
    const meal = buildRecipeInputToHomeMeal(input);
    expect(meal).not.toBeNull();
    expect(meal!.name).toBe('42');
    expect(meal!.ingredients).toEqual([{ name: '100', amount: '2', unit: 'g' }]);
    expect(meal!.steps).toEqual(['12345']);
  });

  it('drops notes whose text is not a string', () => {
    const input = {
      name: 'Soup',
      notes: [
        { type: 'tip', text: 'Chill overnight.' },
        { type: 'tip', text: 42 },
        { type: 'nonsense', text: 'wrong type' },
        null,
      ],
    } as unknown as BuildRecipeInput;
    const meal = buildRecipeInputToHomeMeal(input);
    expect(meal!.notes).toEqual([{ type: 'tip', text: 'Chill overnight.' }]);
  });

  it('still requires a non-empty name', () => {
    expect(buildRecipeInputToHomeMeal({ name: '   ' })).toBeNull();
    expect(buildRecipeInputToHomeMeal({} as BuildRecipeInput)).toBeNull();
  });
});
