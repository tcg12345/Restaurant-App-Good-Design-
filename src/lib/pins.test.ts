import { describe, expect, it } from 'vitest';
import { MAX_PINS, isPinned, normalizePins, togglePin, type PinnedItem } from './pins';

const r = (id: string): PinnedItem => ({ type: 'restaurant', id });

describe('normalizePins', () => {
  it('returns [] for anything that is not an array', () => {
    expect(normalizePins(null)).toEqual([]);
    expect(normalizePins(undefined)).toEqual([]);
    expect(normalizePins('[]')).toEqual([]);
    expect(normalizePins({ type: 'restaurant', id: 'x' })).toEqual([]);
  });

  it('keeps only well-formed pins, dedupes, and caps at three', () => {
    const raw = [
      { type: 'restaurant', id: 'a' },
      { type: 'restaurant', id: 'a' },      // duplicate
      { type: 'hotel', id: 'b' },           // unknown type
      { type: 'guide' },                    // no id
      { type: 'recipe', id: '' },           // empty id
      null,
      { type: 'post', id: 'c' },
      { type: 'reel', id: 'd' },
      { type: 'meal', id: 'e' },            // fourth valid — dropped by the cap
    ];
    expect(normalizePins(raw)).toEqual([
      { type: 'restaurant', id: 'a' },
      { type: 'post', id: 'c' },
      { type: 'reel', id: 'd' },
    ]);
  });
});

describe('togglePin', () => {
  it('adds when absent and removes when present', () => {
    const pins = [r('a')];
    expect(togglePin(pins, r('b'))).toEqual([r('a'), r('b')]);
    expect(togglePin(pins, r('a'))).toEqual([]);
  });

  it('refuses a fourth pin with null rather than dropping one', () => {
    const full = [r('a'), r('b'), r('c')];
    expect(full).toHaveLength(MAX_PINS);
    expect(togglePin(full, r('d'))).toBeNull();
    // Removing from a full set still works.
    expect(togglePin(full, r('b'))).toEqual([r('a'), r('c')]);
  });

  it('treats the same id under a different type as a different pin', () => {
    const pins = [r('a')];
    expect(isPinned(pins, { type: 'guide', id: 'a' })).toBe(false);
    expect(togglePin(pins, { type: 'guide', id: 'a' })).toEqual([r('a'), { type: 'guide', id: 'a' }]);
  });
});
