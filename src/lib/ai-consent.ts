/** Explicit, versioned, account-scoped permission for third-party AI requests. */
export const AI_CONSENT_VERSION = '2026-09-12';
const key = (userId: string) => `goodeats-ai-consent:${userId}`;
let listener: ((userId: string) => void) | null = null;
let pending: { userId: string; resolve: (allowed: boolean) => void; promise: Promise<boolean> } | null = null;
const accepted = new Set<string>();
export function hasAiConsent(userId: string): boolean {
  try { return accepted.has(userId) || localStorage.getItem(key(userId)) === AI_CONSENT_VERSION; } catch { return accepted.has(userId); }
}
export function revokeAiConsent(userId: string): void {
  accepted.delete(userId);
  try { localStorage.removeItem(key(userId)); } catch { /* no persistent storage */ }
  if (pending?.userId === userId) finishAiConsent(false);
}
export function requestAiConsent(userId: string): Promise<boolean> {
  if (hasAiConsent(userId)) return Promise.resolve(true);
  if (pending?.userId === userId) return pending.promise;
  if (pending) finishAiConsent(false);
  if (!listener) return Promise.resolve(false);
  let resolve!: (allowed: boolean) => void;
  const promise = new Promise<boolean>(done => { resolve = done; });
  pending = { userId, promise, resolve };
  listener(userId);
  return promise;
}
export function finishAiConsent(allowed: boolean): void {
  const current = pending; pending = null;
  if (!current) return;
  if (allowed) {
    accepted.add(current.userId);
    try { localStorage.setItem(key(current.userId), AI_CONSENT_VERSION); } catch { /* permission lasts for this session */ }
  }
  current.resolve(allowed);
}
export function subscribeAiConsent(next: (userId: string) => void): () => void {
  listener = next;
  return () => { if (listener === next) { listener = null; finishAiConsent(false); } };
}
