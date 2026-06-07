import { describe, it, expect } from 'vitest';
import {
  computeSimilarity,
  relevanceHint,
  CUISINE_RELATED_CREDIT,
  NEUTRAL_SIMILARITY,
  type SimilarityInput,
} from './restaurantSimilarity';

/** Build a SimilarityInput with everything blank unless overridden, so each
 *  test can isolate a single component. */
function si(over: Partial<SimilarityInput> = {}): SimilarityInput {
  return { cuisine: '', price: '', address: '', ...over };
}

describe('computeSimilarity — cuisine (isolated)', () => {
  it('exact match scores 1.0', () => {
    const r = computeSimilarity(si({ cuisine: 'Italian' }), si({ cuisine: 'Italian' }));
    expect(r.present.cuisine).toBe(true);
    expect(r.score).toBeCloseTo(1.0, 6);
  });

  it('related cuisines earn partial credit', () => {
    const r = computeSimilarity(si({ cuisine: 'Sushi' }), si({ cuisine: 'Japanese' }));
    expect(r.score).toBeCloseTo(CUISINE_RELATED_CREDIT, 6);
  });

  it('unrelated cuisines score 0', () => {
    const r = computeSimilarity(si({ cuisine: 'Italian' }), si({ cuisine: 'Thai' }));
    expect(r.present.cuisine).toBe(true);
    expect(r.score).toBeCloseTo(0, 6);
  });
});

describe('computeSimilarity — price (isolated)', () => {
  it('identical price scores 1.0', () => {
    const r = computeSimilarity(si({ price: '$$$' }), si({ price: '$$$' }));
    expect(r.score).toBeCloseTo(1.0, 6);
  });

  it('two tiers apart scores 0.5', () => {
    const r = computeSimilarity(si({ price: '$$' }), si({ price: '$$$$' }));
    expect(r.score).toBeCloseTo(0.5, 6);
  });

  it('one side unknown drops the component (→ neutral when nothing else)', () => {
    const r = computeSimilarity(si({ price: '$$' }), si({ price: '' }));
    expect(r.present.price).toBe(false);
    expect(r.score).toBeCloseTo(NEUTRAL_SIMILARITY, 6);
  });
});

describe('computeSimilarity — location (isolated)', () => {
  it('identical coordinates score ~1.0', () => {
    const r = computeSimilarity(
      si({ lat: 40.7, lng: -74.0 }),
      si({ lat: 40.7, lng: -74.0 }),
    );
    expect(r.present.location).toBe(true);
    expect(r.score).toBeCloseTo(1.0, 4);
  });

  it('far apart scores ~0', () => {
    const r = computeSimilarity(
      si({ lat: 40.7, lng: -74.0 }),
      si({ lat: 34.0, lng: -118.0 }),
    );
    expect(r.score).toBeLessThan(0.01);
  });

  it('same city (no coords) scores 1.0', () => {
    const r = computeSimilarity(si({ city: 'nyc' }), si({ city: 'nyc' }));
    expect(r.present.location).toBe(true);
    expect(r.score).toBeCloseTo(1.0, 6);
  });

  it('different city scores 0', () => {
    const r = computeSimilarity(si({ city: 'nyc' }), si({ city: 'la' }));
    expect(r.present.location).toBe(true);
    expect(r.score).toBeCloseTo(0, 6);
  });

  it('same city but different neighborhood blends to 0.7', () => {
    const r = computeSimilarity(
      si({ city: 'nyc', neighborhood: 'West Village' }),
      si({ city: 'nyc', neighborhood: 'Soho' }),
    );
    expect(r.score).toBeCloseTo(0.7, 6);
  });
});

describe('computeSimilarity — renormalization', () => {
  it('blends only the present components and renormalizes weights', () => {
    // cuisine exact (1.0, w=0.30) + price two-apart (0.5, w=0.25), nothing else.
    // (0.30*1 + 0.25*0.5) / 0.55 = 0.425 / 0.55 = 0.772727…
    const r = computeSimilarity(
      si({ cuisine: 'Italian', price: '$$$' }),
      si({ cuisine: 'Italian', price: '$' }),
    );
    expect(r.present).toEqual({ location: false, cuisine: true, price: true, tags: false });
    expect(r.score).toBeCloseTo(0.42500 / 0.55, 6);
  });

  it('all components missing → neutral', () => {
    const r = computeSimilarity(si(), si());
    expect(r.present).toEqual({ location: false, cuisine: false, price: false, tags: false });
    expect(r.score).toBeCloseTo(NEUTRAL_SIMILARITY, 6);
  });
});

describe('computeSimilarity — never throws on sparse / odd inputs', () => {
  const weird: SimilarityInput[] = [
    si(),
    si({ cuisine: 'Italian' }),
    si({ price: '$$$$$$' }), // over-long, should clamp
    si({ lat: NaN, lng: 10 }),
    si({ lat: 10 }), // lng missing
    si({ address: 'nonsense with, commas,,,' }),
    si({ tags: ['', '  ', 'Romantic'] }),
    si({ neighborhood: 'X' }), // only one side has a neighborhood
  ];
  it('returns a finite [0,1] score for every pairing', () => {
    for (const a of weird) {
      for (const b of weird) {
        const r = computeSimilarity(a, b);
        expect(Number.isFinite(r.score)).toBe(true);
        expect(r.score).toBeGreaterThanOrEqual(0);
        expect(r.score).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('relevanceHint', () => {
  it('joins location + cuisine + price for a strong match', () => {
    const hint = relevanceHint(
      si({ cuisine: 'Italian', price: '$$', city: 'nyc' }),
      si({ cuisine: 'Italian', price: '$$', city: 'nyc' }),
    );
    expect(hint).toBe('Same city · Italian · $$');
  });

  it('prefers neighborhood phrasing when neighborhoods match', () => {
    const hint = relevanceHint(
      si({ city: 'nyc', neighborhood: 'West Village' }),
      si({ city: 'nyc', neighborhood: 'West Village' }),
    );
    expect(hint).toBe('Same neighborhood');
  });

  it('labels related cuisines', () => {
    const hint = relevanceHint(si({ cuisine: 'Sushi' }), si({ cuisine: 'Japanese' }));
    expect(hint).toBe('Similar cuisine');
  });

  it('says "Nearby" for close coordinates with no city signal', () => {
    const hint = relevanceHint(
      si({ lat: 40.7128, lng: -74.006 }),
      si({ lat: 40.7138, lng: -74.006 }),
    );
    expect(hint).toBe('Nearby');
  });

  it('surfaces a shared tag (original casing)', () => {
    const hint = relevanceHint(si({ tags: ['Romantic'] }), si({ tags: ['Romantic', 'Cozy'] }));
    expect(hint).toBe('Romantic');
  });

  it('returns empty string when nothing matches', () => {
    const hint = relevanceHint(
      si({ cuisine: 'Italian', price: '$$', city: 'nyc' }),
      si({ cuisine: 'Thai', price: '$$$$', city: 'la' }),
    );
    expect(hint).toBe('');
  });
});
