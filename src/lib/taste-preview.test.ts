import { describe, it, expect } from 'vitest';
import { __testing } from './taste-preview';
import type { PlaceResult } from './places';

const place = (name: string, types: string[]): PlaceResult => ({
  id: name, name, types,
  address: '', fullAddress: '', lat: 0, lng: 0,
  rating: 4.5, userRatingCount: 100, priceLevel: 4,
} as unknown as PlaceResult);

describe('matchesStatedCuisine — protects the "built from your answers" claim', () => {
  const { matchesStatedCuisine } = __testing;

  it('matches on Google\'s own type, which is the asserted signal', () => {
    expect(matchesStatedCuisine(place('Noz', ['japanese_restaurant']), ['Japanese'])).toBe(true);
  });

  it('rejects the celebrated brasserie a Japanese query dragged in', () => {
    // This is the exact failure the user reported: a French brasserie and a
    // wine bar leading a Japanese/$$$$ profile's first picks.
    expect(matchesStatedCuisine(place('La Grande Boucherie', ['french_restaurant']), ['Japanese'])).toBe(false);
    expect(matchesStatedCuisine(place('Isla & Co', ['wine_bar']), ['Japanese'])).toBe(false);
    expect(matchesStatedCuisine(place('Shukette', ['middle_eastern_restaurant']), ['Japanese'])).toBe(false);
  });

  it('honours any one of several stated cuisines', () => {
    expect(matchesStatedCuisine(place('Rubirosa', ['italian_restaurant']), ['Japanese', 'Italian'])).toBe(true);
  });

  it('keeps everything when nothing was stated — no answers, no filter', () => {
    expect(matchesStatedCuisine(place('Anywhere', ['french_restaurant']), [])).toBe(true);
  });
});
