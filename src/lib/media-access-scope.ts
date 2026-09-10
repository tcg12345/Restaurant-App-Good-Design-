/** Identity boundary shared by signed URLs and decoded media caches. */
let version = 0;
const listeners = new Set<() => void>();
export const mediaAccessVersion = () => version;
export function onMediaAccessChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function resetMediaAccess(): void {
  version++;
  for (const listener of listeners) listener();
}
