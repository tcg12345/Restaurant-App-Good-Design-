import { describe, it, expect } from 'vitest';
import { parseIngredientLine, normalizeUnit, parseAmount, displayUnit } from './ingredient-parsing';

describe('parseIngredientLine', () => {
  it('does NOT fuzzy-match ingredient words into units ("2 bay leaves" ≠ "2 bags")', () => {
    expect(parseIngredientLine('2 bay leaves')).toEqual({ amount: '2', unit: '', name: 'bay leaves' });
  });

  it('"3 ears corn" keeps "ears" in the name instead of becoming "jars"', () => {
    expect(parseIngredientLine('3 ears corn')).toEqual({ amount: '3', unit: '', name: 'ears corn' });
  });

  it('"1 bunch cilantro" matches the real unit via its exact alias', () => {
    // "bunch" IS in the unit catalog — exact-alias matching still applies in
    // strict mode; only the fuzzy Levenshtein pass is disabled.
    expect(parseIngredientLine('1 bunch cilantro')).toEqual({ amount: '1', unit: 'bunches', name: 'cilantro' });
  });

  it('still recognizes exact one-word and two-word units', () => {
    expect(parseIngredientLine('2 cups flour')).toEqual({ amount: '2', unit: 'cups', name: 'flour' });
    expect(parseIngredientLine('1 1/2 tbsp olive oil')).toEqual({ amount: '1 1/2', unit: 'tbsp', name: 'olive oil' });
    expect(parseIngredientLine('3 fluid ounces milk')).toEqual({ amount: '3', unit: 'fl oz', name: 'milk' });
  });

  it('handles bullets, unitless lines, and amountless lines', () => {
    expect(parseIngredientLine('- 2 eggs')).toEqual({ amount: '2', unit: '', name: 'eggs' });
    expect(parseIngredientLine('salt to taste')).toEqual({ amount: '', unit: '', name: 'salt to taste' });
    expect(parseIngredientLine('')).toBeNull();
  });

  it('keeps the T/t tablespoon-teaspoon case distinction', () => {
    expect(parseIngredientLine('1 T butter')).toEqual({ amount: '1', unit: 'tbsp', name: 'butter' });
    expect(parseIngredientLine('1 t vanilla')).toEqual({ amount: '1', unit: 'tsp', name: 'vanilla' });
  });
});

describe('normalizeUnit', () => {
  it('strict mode accepts exact aliases and rejects near-misses', () => {
    expect(normalizeUnit('tablespoons', true)).toBe('tbsp');
    expect(normalizeUnit('bay', true)).toBe('');
    expect(normalizeUnit('ears', true)).toBe('');
    expect(normalizeUnit('gramms', true)).toBe('');
  });

  it('fuzzy mode (the unit combobox) still corrects typos', () => {
    expect(normalizeUnit('gramms')).toBe('g');
    expect(normalizeUnit('tablespon')).toBe('tbsp');
  });
});

describe('amount + display helpers', () => {
  it('parses mixed fractions, decimals, and ranges', () => {
    expect(parseAmount('1 1/2')).toBe(1.5);
    expect(parseAmount('.5')).toBe(0.5);
    expect(parseAmount('1-2')).toBe(1);
  });

  it('renders singular for amounts ≤ 1', () => {
    expect(displayUnit('bunches', 1)).toBe('bunch');
    expect(displayUnit('cups', 2)).toBe('cups');
  });
});
