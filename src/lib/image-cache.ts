/**
 * In-memory image blob cache for the reels feed.
 *
 * Feed post photos unmount when they scroll out of the preload window and
 * remount when you scroll back. With large source images served from a private
 * bucket (whose cache-control we don't control for already-uploaded files), the
 * browser re-downloads them on every return and paints them in progressively —
 * the "loads choppy, a third at a time, every time you go back" symptom.
 *
 * We fetch each photo once into a Blob and hand out a stable object URL. On the
 * next mount the object URL is already in memory, so the image appears at once
 * (no progressive banding) with zero network — regardless of the server's cache
 * headers. A small LRU bounds memory; falling back to the original URL keeps
 * things working if a fetch is blocked (e.g. CORS) or fails.
 */

const cache = new Map<string, string>(); // path → object URL
const order: string[] = [];               // LRU order, oldest first
const inflight = new Map<string, Promise<string | null>>();
// Bounded low: pre-compression photos can be 5–8 MB each, and each cached
// entry pins that blob in memory until evicted. ~24 keeps a comfortable scroll
// window warm without ballooning memory on mobile.
const MAX_ENTRIES = 24;

function touch(path: string): void {
  const i = order.indexOf(path);
  if (i >= 0) order.splice(i, 1);
  order.push(path);
  while (order.length > MAX_ENTRIES) {
    const evict = order.shift();
    if (!evict) break;
    const url = cache.get(evict);
    if (url) { try { URL.revokeObjectURL(url); } catch { /* ignore */ } }
    cache.delete(evict);
  }
}

/** Synchronously return a cached object URL for this path, or null. */
export function getCachedImage(path: string): string | null {
  if (!path) return null;
  const url = cache.get(path);
  if (url) touch(path);
  return url ?? null;
}

/**
 * Fetch the image once and cache its blob, returning a stable object URL.
 * Resolves to the original `url` if the fetch is blocked/fails so the caller
 * can still render something. De-dupes concurrent requests for the same path.
 */
export async function loadCachedImage(path: string, url: string): Promise<string> {
  if (!path || !url) return url;
  const existing = cache.get(path);
  if (existing) { touch(path); return existing; }
  const pending = inflight.get(path);
  if (pending) return (await pending) ?? url;

  const job = (async (): Promise<string | null> => {
    try {
      const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
      if (!res.ok) return null;
      const blob = await res.blob();
      const obj = URL.createObjectURL(blob);
      cache.set(path, obj);
      touch(path);
      return obj;
    } catch {
      return null; // CORS / network — caller falls back to the direct URL
    } finally {
      inflight.delete(path);
    }
  })();
  inflight.set(path, job);
  return (await job) ?? url;
}
