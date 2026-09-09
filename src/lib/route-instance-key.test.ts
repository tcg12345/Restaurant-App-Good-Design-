import { expect, it } from 'vitest';
import { routeInstanceKey } from './route-instance-key';
it('preserves the social page for same-slot replacements, but separates pushed conversations', () => {
  expect(routeInstanceKey('/messages', 'original', 2)).toBe(routeInstanceKey('/messages', 'friends', 2));
  expect(routeInstanceKey('/messages', 'conversation', 3)).not.toBe(routeInstanceKey('/messages', 'friends', 2));
});
it('preserves history-entry identity on other pages and without a known history index', () => {
  expect(routeInstanceKey('/calendar', 'calendar-key', 2)).toBe('calendar-key');
  expect(routeInstanceKey('/restaurant/id', 'detail-key', 3)).toBe('detail-key');
  expect(routeInstanceKey('/messages', 'fallback-key', null)).toBe('fallback-key');
});
