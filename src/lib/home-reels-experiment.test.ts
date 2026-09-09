// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
afterEach(() => { vi.doUnmock('./home-reels-experiment'); vi.resetModules(); });
it.each([true, false])('keeps native navigation and Back behavior aligned when experiment=%s', async enabled => {
  vi.resetModules();
  vi.doMock('./home-reels-experiment', () => ({ HOME_REELS_EXPERIMENT: enabled }));
  const { GLASS_TAB_ITEMS, activeTabPath } = await import('./native-glass');
  const { isTabRootLocation, routeBackGesture } = await import('./nav-stack');
  const tab = enabled ? '/messages' : '/reels';
  const viewer = enabled ? '/reels' : '/calendar';
  expect(GLASS_TAB_ITEMS.map(i=>i.path)).toEqual(['/', '/search', '/pantry', tab, '/profile']);
  expect(activeTabPath(tab)).toBe(tab);
  expect(activeTabPath(viewer)).toBe('');
  expect(isTabRootLocation(tab, '')).toBe(true);
  expect(routeBackGesture(tab, '', {navigationPresentation:'tab'}, true)).toBeNull();
  expect(routeBackGesture('/r/reel-123', '', null, true)).toBe('right');
  if (enabled) expect(routeBackGesture('/reels', '', null, true)).toBe('right');
});
