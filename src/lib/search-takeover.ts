/**
 * Whether the Search tab's full-screen search takeover is open.
 *
 * A module-level signal rather than context, for the same reason the
 * overlay registry is one: the two parties — the Search page that owns the
 * takeover and the assistant FAB that repositions its life around it — are
 * mounted in unrelated corners of the tree, and threading a provider
 * between them would drag the app shell into a page's private state.
 */
let open = false;
const subscribers = new Set<(open: boolean) => void>();

export function setSearchTakeoverOpen(next: boolean): void {
  if (next === open) return;
  open = next;
  for (const fn of subscribers) fn(next);
}

export function isSearchTakeoverOpen(): boolean {
  return open;
}

export function subscribeSearchTakeover(fn: (open: boolean) => void): () => void {
  subscribers.add(fn);
  return () => { subscribers.delete(fn); };
}
