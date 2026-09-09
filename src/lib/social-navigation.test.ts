import { expect, it } from 'vitest';
import { isSocialConversation } from './social-navigation';
it('keeps both social inbox tabs above the navbar', () => {
  expect(isSocialConversation('')).toBe(false);
  expect(isSocialConversation('?tab=friends')).toBe(false);
  expect(isSocialConversation('?tab=friends&conversation=old')).toBe(false);
});
it('covers the navbar for all supported conversation entry points', () => {
  expect(isSocialConversation('?conversation=thread-1')).toBe(true);
  expect(isSocialConversation('?to=user-1')).toBe(true);
  expect(isSocialConversation('', {openUserId:'friend-1'})).toBe(true);
});
