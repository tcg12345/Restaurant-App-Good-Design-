/** Thread routes cover the tab bar; both inbox tabs keep it visible. */
export function isSocialConversation(search: string, state?: { openUserId?: string } | null): boolean {
  const params = new URLSearchParams(search);
  return params.get('tab') !== 'friends' && !!(params.get('conversation') || params.get('to') || state?.openUserId);
}
