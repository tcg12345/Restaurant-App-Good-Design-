import { describe, it, expect } from 'vitest';
import { dedupeExtracted, type ExtractedRestaurant } from './import-restaurants-client';

const r = (over: Partial<ExtractedRestaurant> & { name: string }): ExtractedRestaurant => ({ ...over });

describe('dedupeExtracted', () => {
  it('collapses exact name+city duplicates from overlapping screenshots', () => {
    const out = dedupeExtracted([
      r({ name: 'COTE Flatiron', city: 'New York, NY', score: 9.7 }),
      r({ name: 'COTE Flatiron', city: 'New York, NY', score: 9.7 }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].score).toBe(9.7);
  });

  it('is case- and whitespace-insensitive on the key', () => {
    const out = dedupeExtracted([
      r({ name: 'Cote  Flatiron', city: 'new york, ny' }),
      r({ name: 'COTE Flatiron', city: 'New York, NY' }),
    ]);
    expect(out).toHaveLength(1);
  });

  it('merges a city-less copy into the same-name entry with a city', () => {
    const out = dedupeExtracted([
      r({ name: 'Nobu', score: 8.8 }),
      r({ name: 'Nobu', city: 'New York, NY', cuisine: 'Japanese' }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].city).toBe('New York, NY');
    expect(out[0].score).toBe(8.8);
    expect(out[0].cuisine).toBe('Japanese');
  });

  it('keeps same-named restaurants in DIFFERENT cities as separate rows', () => {
    const out = dedupeExtracted([
      r({ name: 'Cheval Blanc', city: 'Lembach', score: 9.0 }),
      r({ name: 'Cheval Blanc', city: 'Paris', score: 9.5 }),
    ]);
    expect(out).toHaveLength(2);
  });

  it('never demotes a rated copy to wishlist when merging', () => {
    const out = dedupeExtracted([
      r({ name: 'Carbone', city: 'New York', wishlist: true }),
      r({ name: 'Carbone', city: 'New York', score: 9.1 }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].wishlist).toBe(false);
    expect(out[0].score).toBe(9.1);
  });

  it('keeps the richer fields from either copy', () => {
    const out = dedupeExtracted([
      r({ name: 'Indienne', city: 'Chicago', notes: 'tasting menu' }),
      r({ name: 'Indienne', city: 'Chicago', score: 9.5, cuisine: 'Indian' }),
    ]);
    expect(out).toEqual([
      { name: 'Indienne', city: 'Chicago', cuisine: 'Indian', score: 9.5, wishlist: false, notes: 'tasting menu' },
    ]);
  });
});
