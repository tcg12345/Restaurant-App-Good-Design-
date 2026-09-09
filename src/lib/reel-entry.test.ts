import { expect, it } from 'vitest';
import { reelEntryKey } from './reel-entry';

const items = [{ key: 'reel-first' }, { key: 'post-saved' }, { key: 'reel-selected' }];
it('opens a linked reel before the first or previously viewed item', () => {
  expect(reelEntryKey(items, 'reel-selected', 'saved')).toBe('reel-selected');
});
it('restores a post for the general viewer and tolerates deleted items', () => {
  expect(reelEntryKey(items, undefined, 'saved')).toBe('post-saved');
  expect(reelEntryKey(items, 'reel-deleted', 'deleted')).toBe('reel-first');
  expect(reelEntryKey([], 'reel-selected')).toBeNull();
});
it('finds a focused item even when a refresh replaces an equal-size page', () => {
  expect(reelEntryKey(items.slice(0, 2), 'reel-selected')).toBe('reel-first');
  expect(reelEntryKey([items[0], items[2]], 'reel-selected')).toBe('reel-selected');
});
