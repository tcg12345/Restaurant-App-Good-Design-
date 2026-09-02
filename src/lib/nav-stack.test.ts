import { describe, it, expect, beforeEach } from 'vitest';
import { recordNavEntry, navEntryAt, logicalParent, isTabRootLocation, backTargetFor } from './nav-stack';

// The module keeps a session-global map; rebuild it from scratch per test by
// pushing a fresh entry at idx 0 (PUSH prunes everything forward).
const resetWith = (pathname: string, search = '') => {
  recordNavEntry(0, { pathname, search }, 'PUSH');
};

describe('logicalParent', () => {
  it('maps pantry sub-views to the pantry root', () => {
    expect(logicalParent('/pantry', '?list=abc')).toBe('/pantry');
    expect(logicalParent('/pantry', '?list=__wishlist__')).toBe('/pantry');
    expect(logicalParent('/pantry', '?view=home-cooking')).toBe('/pantry');
    expect(logicalParent('/profile/taste', '')).toBe('/profile');
    expect(logicalParent('/profile/top/cuisine:Japanese', '')).toBe('/profile');
    expect(logicalParent('/user/jamie/taste', '')).toBe('/user/jamie');
    expect(logicalParent('/pantry', '?view=trips')).toBe('/pantry');
  });

  it('treats the plain pantry root (and transient params) as having no parent', () => {
    expect(logicalParent('/pantry', '')).toBeNull();
    expect(logicalParent('/pantry', '?new-list=1')).toBeNull();
  });

  it('maps activity filters, circle reviews and guide edit to their parents', () => {
    expect(logicalParent('/activity/saved', '')).toBe('/activity');
    expect(logicalParent('/activity/drafts', '')).toBe('/activity');
    expect(logicalParent('/restaurant/r-1/circle', '')).toBe('/restaurant/r-1');
    expect(logicalParent('/guides/g-1/edit', '')).toBe('/guides/g-1');
    expect(logicalParent('/location/map', '')).toBe('/location');
  });

  it('gives detail pages no static parent (history decides)', () => {
    expect(logicalParent('/restaurant/r-1', '')).toBeNull();
    expect(logicalParent('/recipe/u/r', '')).toBeNull();
    expect(logicalParent('/activity', '')).toBeNull();
  });
});

describe('isTabRootLocation', () => {
  it('is true on plain tab roots', () => {
    for (const p of ['/', '/search/main', '/pantry', '/profile', '/search']) {
      expect(isTabRootLocation(p, '')).toBe(true);
    }
  });

  it('is false on tab sub-views and ordinary pages', () => {
    expect(isTabRootLocation('/pantry', '?list=abc')).toBe(false);
    expect(isTabRootLocation('/pantry', '?view=trips')).toBe(false);
    expect(isTabRootLocation('/restaurant/r-1', '')).toBe(false);
  });
});

describe('backTargetFor', () => {
  beforeEach(() => resetWith('/'));

  it('pops when the previous entry is the sub-view\'s parent', () => {
    recordNavEntry(1, { pathname: '/pantry', search: '' }, 'PUSH');
    recordNavEntry(2, { pathname: '/pantry', search: '?list=abc' }, 'PUSH');
    expect(backTargetFor(2, '/pantry', '?list=abc')).toEqual({ kind: 'pop' });
  });

  it('pops between sibling sub-views of the same flow', () => {
    recordNavEntry(1, { pathname: '/pantry', search: '' }, 'PUSH');
    recordNavEntry(2, { pathname: '/pantry', search: '?view=home-cooking' }, 'PUSH');
    recordNavEntry(3, { pathname: '/pantry', search: '?list=abc' }, 'PUSH');
    expect(backTargetFor(3, '/pantry', '?list=abc')).toEqual({ kind: 'pop' });
  });

  it('goes up to the parent when history would exit the flow sideways', () => {
    recordNavEntry(1, { pathname: '/reels', search: '' }, 'PUSH');
    recordNavEntry(2, { pathname: '/pantry', search: '?list=abc' }, 'PUSH');
    expect(backTargetFor(2, '/pantry', '?list=abc')).toEqual({ kind: 'parent', to: '/pantry' });
  });

  it('goes up to the parent when the previous entry is unknown (reload)', () => {
    expect(backTargetFor(5, '/pantry', '?list=abc')).toEqual({ kind: 'parent', to: '/pantry' });
    expect(backTargetFor(5, '/activity/saved', '')).toEqual({ kind: 'parent', to: '/activity' });
  });

  it('pops detail pages to wherever they were opened from', () => {
    recordNavEntry(1, { pathname: '/restaurant/r-1', search: '' }, 'PUSH');
    expect(backTargetFor(1, '/restaurant/r-1', '')).toEqual({ kind: 'pop' });
  });

  it('has no target at the session root without a parent', () => {
    expect(backTargetFor(0, '/', '')).toBeNull();
    expect(backTargetFor(0, '/restaurant/r-1', '')).toBeNull();
  });

  it('still offers the parent at the session root for sub-views', () => {
    expect(backTargetFor(0, '/pantry', '?list=abc')).toEqual({ kind: 'parent', to: '/pantry' });
  });

  it('prunes forward entries on PUSH so stale branches never resolve', () => {
    recordNavEntry(1, { pathname: '/pantry', search: '' }, 'PUSH');
    recordNavEntry(2, { pathname: '/pantry', search: '?list=abc' }, 'PUSH');
    // Back to idx 1, then push a different branch over idx 2.
    recordNavEntry(2, { pathname: '/restaurant/r-9', search: '' }, 'PUSH');
    expect(navEntryAt(2)).toEqual({ pathname: '/restaurant/r-9', search: '' });
    recordNavEntry(1, { pathname: '/profile', search: '' }, 'PUSH');
    expect(navEntryAt(2)).toBeUndefined();
  });

  it('REPLACE overwrites in place without pruning forward entries', () => {
    recordNavEntry(1, { pathname: '/pantry', search: '?new-list=1' }, 'PUSH');
    recordNavEntry(1, { pathname: '/pantry', search: '' }, 'REPLACE');
    expect(navEntryAt(1)).toEqual({ pathname: '/pantry', search: '' });
    expect(navEntryAt(0)).toBeDefined();
  });
});
