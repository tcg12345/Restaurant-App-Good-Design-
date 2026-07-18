import { describe, it, expect } from 'vitest';
import { parseQuantity, formatQuantity, scaleQuantity } from './recipe-display';

describe('parseQuantity', () => {
  it('parses ASCII amounts', () => {
    expect(parseQuantity('2')).toBe(2);
    expect(parseQuantity('1/2')).toBe(0.5);
    expect(parseQuantity('1 1/2')).toBe(1.5);
    expect(parseQuantity('0.5')).toBe(0.5);
  });

  it('parses unicode vulgar fractions and compounds', () => {
    expect(parseQuantity('½')).toBe(0.5);
    expect(parseQuantity('1½')).toBe(1.5);
    expect(parseQuantity('¾')).toBe(0.75);
  });

  it('returns null for free text', () => {
    expect(parseQuantity('a pinch')).toBeNull();
  });
});

describe('scaleQuantity (the servings stepper)', () => {
  it('doubles "½ cup sugar" amounts to "1"', () => {
    expect(scaleQuantity('½', 2)).toBe('1');
  });

  it('scales ranges on both endpoints: "2-3" eggs ×2 → "4-6"', () => {
    expect(scaleQuantity('2-3', 2)).toBe('4-6');
    expect(scaleQuantity('2–3', 2)).toBe('4-6'); // en dash from imports
  });

  it('scales unicode compounds and fraction ranges', () => {
    expect(scaleQuantity('1½', 2)).toBe('3');
    expect(scaleQuantity('½-¾', 2)).toBe('1-1 1/2');
  });

  it('renders cooking fractions and passes free text through', () => {
    expect(scaleQuantity('1/2', 3)).toBe('1 1/2');
    expect(scaleQuantity('pinch', 2)).toBe('pinch');
  });

  it('does not mistake a mixed fraction for a range', () => {
    expect(scaleQuantity('1 1/2', 2)).toBe('3');
    expect(scaleQuantity('1 1/2-2', 2)).toBe('3-4');
  });
});

describe('formatQuantity', () => {
  it('rounds to cook-friendly fractions', () => {
    expect(formatQuantity(1.5)).toBe('1 1/2');
    expect(formatQuantity(0.25)).toBe('1/4');
    expect(formatQuantity(2)).toBe('2');
  });
});
