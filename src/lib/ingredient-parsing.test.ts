import { describe, it, expect } from 'vitest';
import { parseIngredientLine, normalizeUnit, normalizeQuantityToken, parseAmount, displayUnit } from './ingredient-parsing';

describe('normalizeQuantityToken', () => {
  it('maps unicode vulgar fractions to ASCII', () => {
    expect(normalizeQuantityToken('½')).toBe('1/2');
    expect(normalizeQuantityToken('¾')).toBe('3/4');
    expect(normalizeQuantityToken('⅚')).toBe('5/6');
  });

  it('keeps the whole part of compounds ("1½" and "1 ½" → "1 1/2")', () => {
    expect(normalizeQuantityToken('1½')).toBe('1 1/2');
    expect(normalizeQuantityToken('2 ¾')).toBe('2 3/4');
  });

  it('normalizes en/em dashes and the fraction slash', () => {
    expect(normalizeQuantityToken('2–3')).toBe('2-3');
    expect(normalizeQuantityToken('2—3')).toBe('2-3');
    expect(normalizeQuantityToken('1⁄2')).toBe('1/2');
  });

  it('leaves plain text untouched', () => {
    expect(normalizeQuantityToken('to taste')).toBe('to taste');
    expect(normalizeQuantityToken('1 1/2')).toBe('1 1/2');
  });
});

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

  it('parses unicode-fraction and dash-range lines (importer output)', () => {
    expect(parseIngredientLine('½ cup sugar')).toEqual({ amount: '1/2', unit: 'cups', name: 'sugar' });
    expect(parseIngredientLine('1½ cups flour')).toEqual({ amount: '1 1/2', unit: 'cups', name: 'flour' });
    expect(parseIngredientLine('2–3 eggs')).toEqual({ amount: '2-3', unit: '', name: 'eggs' });
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

  it('parses unicode fractions and dash ranges', () => {
    expect(parseAmount('½')).toBe(0.5);
    expect(parseAmount('1½')).toBe(1.5);
    expect(parseAmount('2–3')).toBe(2);
  });

  it('renders singular for amounts ≤ 1', () => {
    expect(displayUnit('bunches', 1)).toBe('bunch');
    expect(displayUnit('cups', 2)).toBe('cups');
  });
});
