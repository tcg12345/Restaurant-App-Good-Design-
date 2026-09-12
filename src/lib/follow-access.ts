import { resetMediaAccess } from './media-access-scope';

type FollowChange = { authorId: string; following: boolean };
const listeners = new Set<(change: FollowChange) => void>();
export function onFollowAccessChange(listener: (change: FollowChange) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
/** Reauthorize cached media whenever this viewer changes a follow. */
export function notifyFollowAccessChange(authorId: string, following: boolean): void {
  resetMediaAccess();
  for (const listener of listeners) listener({ authorId, following });
}
