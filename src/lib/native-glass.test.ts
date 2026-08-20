import { describe, it, expect } from 'vitest';
import { activeTabPath, GLASS_TAB_ITEMS } from './native-glass';

describe('activeTabPath', () => {
  it('lights the tab that owns the route', () => {
    expect(activeTabPath('/')).toBe('/');
    expect(activeTabPath('/search')).toBe('/search');
    expect(activeTabPath('/reels')).toBe('/reels');
    expect(activeTabPath('/pantry')).toBe('/pantry');
    expect(activeTabPath('/profile')).toBe('/profile');
  });

  it('keeps the tab lit on its sub-routes', () => {
    expect(activeTabPath('/search/main')).toBe('/search');
    expect(activeTabPath('/pantry/recommended')).toBe('/pantry');
    expect(activeTabPath('/profile/settings/privacy')).toBe('/profile');
  });

  it('lights nothing on routes no tab owns', () => {
    // These all pass showBottomNav, so the bar is on screen — it just must
    // not claim to be on Home while you are somewhere else entirely.
    for (const p of ['/experts', '/import', '/verify/apply', '/admin/reports', '/circle']) {
      expect(activeTabPath(p)).toBe('');
    }
  });

  it('does not treat a prefix collision as ownership', () => {
    expect(activeTabPath('/searching')).toBe('');
    expect(activeTabPath('/profiles')).toBe('');
  });

  it('only ever returns a real tab path or the empty string', () => {
    const paths = new Set(GLASS_TAB_ITEMS.map((i) => i.path));
    for (const p of ['/', '/search/main', '/reels', '/experts', '/x/y/z']) {
      const owner = activeTabPath(p);
      expect(owner === '' || paths.has(owner)).toBe(true);
    }
  });
});
