import { describe, it, expect } from 'vitest';
import {
  matchInIndex,
  michelinCityMatchesAddress,
  normalize,
  type MichelinIndex,
  type MichelinInfo,
} from './michelin';

/* ── Fixtures ──────────────────────────────────────────────────────────── */

const rec = (name: string, city: string, over: Partial<MichelinInfo> = {}): MichelinInfo => ({
  name,
  city,
  country: 'USA',
  stars: 3,
  bibGourmand: false,
  selected: false,
  priceTier: 4,
  cuisine: 'Contemporary',
  guideUrl: '',
  greenStar: false,
  lat: NaN,
  lng: NaN,
  ...over,
});

const indexFor = (records: MichelinInfo[]): MichelinIndex => {
  const byName = new Map<string, MichelinInfo[]>();
  for (const r of records) {
    const key = normalize(r.name);
    const bucket = byName.get(key);
    if (bucket) bucket.push(r);
    else byName.set(key, [r]);
  }
  return { grid: new Map(), byName };
};

/* ── Name-only fallback (the false-positive path) ──────────────────────── */

describe('matchInIndex name-only fallback', () => {
  it('returns null with NO address, even for a globally unique name', () => {
    // A random restaurant that happens to be named "The French Laundry"
    // anywhere on Earth must not inherit Yountville's stars.
    const index = indexFor([rec('The French Laundry', 'Yountville')]);
    expect(matchInIndex(index, 'The French Laundry')).toBeNull();
    expect(matchInIndex(index, 'The French Laundry', undefined, undefined, '')).toBeNull();
  });

  it('matches when the address city equals the record city', () => {
    const index = indexFor([rec('Coyote Cafe', 'Santa Fe')]);
    const hit = matchInIndex(index, 'Coyote Cafe', undefined, undefined,
      '132 W Water St, Santa Fe, NM 87501, USA');
    expect(hit?.city).toBe('Santa Fe');
  });

  it('a Santa Monica address does NOT match a record city of Santa Fe', () => {
    // The old first-≥4-char-token compare accepted this ("santa" ⊂ both).
    const index = indexFor([rec('Coyote Cafe', 'Santa Fe')]);
    expect(matchInIndex(index, 'Coyote Cafe', undefined, undefined,
      '1445 Ocean Ave, Santa Monica, CA 90401, USA')).toBeNull();
  });

  it('a New York address does NOT match a record city of York', () => {
    // The old raw substring check accepted this ("york" ⊂ "new york").
    const index = indexFor([rec('Skosh', 'York')]);
    expect(matchInIndex(index, 'Skosh', undefined, undefined,
      '98 Broadway, New York, NY 10001, USA')).toBeNull();
    // …while a genuine York (UK) address still matches.
    expect(matchInIndex(index, 'Skosh', undefined, undefined,
      '98 Micklegate, York YO1 6JX, UK')?.city).toBe('York');
  });

  it('disambiguates same-named records by city', () => {
    const index = indexFor([
      rec('Osteria', 'Milan'),
      rec('Osteria', 'Chicago'),
    ]);
    expect(matchInIndex(index, 'Osteria', undefined, undefined,
      '100 W Randolph St, Chicago, IL 60601, USA')?.city).toBe('Chicago');
  });
});

describe('michelinCityMatchesAddress', () => {
  it('requires the whole city, not a shared leading token', () => {
    expect(michelinCityMatchesAddress('Santa Fe', 'Ocean Ave, Santa Monica, CA, USA')).toBe(false);
    expect(michelinCityMatchesAddress('Santa Fe', 'W Water St, Santa Fe, NM, USA')).toBe(true);
  });

  it('is empty-safe', () => {
    expect(michelinCityMatchesAddress('', 'Santa Fe, NM, USA')).toBe(false);
    expect(michelinCityMatchesAddress('Santa Fe', undefined)).toBe(false);
    expect(michelinCityMatchesAddress('Santa Fe', '')).toBe(false);
  });
});
