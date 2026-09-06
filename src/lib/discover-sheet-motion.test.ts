import { describe, expect, it } from 'vitest';
import { discoverSheetStops, nearestDiscoverSnap } from './discover-sheet-motion';
describe('Discover sheet geometry', () => {
  it.each([568, 844, 932])('keeps all three stops ordered on a %ipx screen', h => {
    const s = discoverSheetStops(h, 230);
    expect(s.full).toBeLessThan(s.half);
    expect(s.half).toBeLessThan(s.peek);
    expect(h - s.peek).toBe(149);
  });
  it('uses the current release position when an animation is interrupted', () => {
    const s = discoverSheetStops(844, 176);
    expect(nearestDiscoverSnap(210, 0, s)).toBe('full');
    expect(nearestDiscoverSnap(650, 0, s)).toBe('peek');
  });
  it('flicks toward the next stop, and slow releases use the nearest stop', () => {
    const s = discoverSheetStops(844, 176);
    expect(nearestDiscoverSnap(s.half, -1.1, s)).toBe('full');
    expect(nearestDiscoverSnap(s.half, 1.5, s)).toBe('peek');
    expect(nearestDiscoverSnap(s.half + 20, 0, s)).toBe('half');
  });
});
