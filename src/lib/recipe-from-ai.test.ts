import { describe, it, expect } from 'vitest';
import { buildRecipeInputToHomeMeal, withRecipeCover, type BuildRecipeInput } from './recipe-from-ai';

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

describe('AI draft cover controls', () => {
  const meal = { ...buildRecipeInputToHomeMeal({ name: 'Test dish' })!, coverPhoto: 'old.jpg', photos: [
    { url: 'old.jpg', caption: 'Original dish', isFavorite: true },
    { url: 'new.jpg', caption: 'My version', isFavorite: false },
  ] };
  it('selects an existing photo without duplicating it or losing its caption', () => {
    const result = withRecipeCover(meal, 'new.jpg');
    expect(result.coverPhoto).toBe('new.jpg');
    expect(result.photos).toEqual([meal.photos[1], meal.photos[0]]);
  });
  it('adds an uploaded cover as a photo object that the editor can read', () => {
    const result = withRecipeCover(meal, 'upload.jpg');
    expect(result.photos[0]).toEqual({ url: 'upload.jpg', caption: '', isFavorite: false });
    expect(result.photos).toHaveLength(3);
  });
  it('removes the cover while preserving other photos and the original draft', () => {
    const result = withRecipeCover(meal, null);
    expect(result.coverPhoto).toBeUndefined();
    expect(result.photos).toEqual([meal.photos[1]]);
    expect(meal.photos).toHaveLength(2);
  });
});
