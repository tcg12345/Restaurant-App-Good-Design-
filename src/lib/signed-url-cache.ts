/**
 * Persistent cache for Supabase Storage signed URLs.
 *
 * Reels/posts live in PRIVATE buckets, so the client mints short-lived signed
 * URLs at read time. Without caching, every app load (and every provider
 * remount) re-signs the same paths and gets a BRAND-NEW token each time. A new
 * URL is a new cache key to the browser, so media that never changed gets
 * re-downloaded from scratch on every visit — that's the regression that made
 * reels/posts feel slow versus the old, stable public-bucket URLs.
 *
 * Reusing a still-valid signed URL keeps the URL byte-for-byte stable, so the
 * browser's HTTP cache serves the bytes instantly next time and we skip the
 * sign round-trip entirely. Signed URLs are safe to persist: they already sit
 * in the DOM as <img>/<video> src and expire on their own.
 */

interface Entry { url: string; expiresAt: number }

const MEM = new Map<string, Entry>();
const LS_KEY = 'sb-signed-urls-v1';
// Re-sign this far BEFORE real expiry so we never hand out a token that dies
// mid-view (e.g. a video that's still buffering when the URL lapses).
const SAFETY_MS = 60 * 60 * 1000; // 1h

// `variant` distinguishes differently-transformed signed URLs for the same
// object (e.g. a 1280px display variant vs the full-res original) so one never
// gets served where the other is expected.
const keyOf = (bucket: string, path: string, variant = '') =>
  `${bucket}:${path}${variant ? `@${variant}` : ''}`;

let hydrated = false;
function hydrate(): void {
  if (hydrated) return;
  hydrated = true;
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return;
    const obj = JSON.parse(raw) as Record<string, Entry>;
    const now = Date.now();
    for (const [k, v] of Object.entries(obj)) {
      if (v && typeof v.url === 'string' && v.expiresAt > now) MEM.set(k, v);
    }
  } catch { /* corrupt / unavailable — memory cache still works */ }
}

let savePending = false;
function scheduleSave(): void {
  if (savePending) return;
  savePending = true;
  // Signing happens in bursts (a whole feed at once); coalesce into one write.
  Promise.resolve().then(() => {
    savePending = false;
    try {
      const now = Date.now();
      const obj: Record<string, Entry> = {};
      for (const [k, v] of MEM) if (v.expiresAt > now) obj[k] = v;
      localStorage.setItem(LS_KEY, JSON.stringify(obj));
    } catch { /* quota / private mode — fine */ }
  });
}

/** Return a cached signed URL for `bucket/path` (optionally a transform
 *  `variant`), or null if absent/near-expiry. */
export function getCachedSignedUrl(bucket: string, path: string, variant = ''): string | null {
  hydrate();
  const entry = MEM.get(keyOf(bucket, path, variant));
  if (!entry) return null;
  if (entry.expiresAt - Date.now() <= SAFETY_MS) return null;
  return entry.url;
}

/** Remember a freshly-minted signed URL for the duration of its TTL. */
export function putCachedSignedUrl(bucket: string, path: string, url: string, ttlSeconds: number, variant = ''): void {
  MEM.set(keyOf(bucket, path, variant), { url, expiresAt: Date.now() + ttlSeconds * 1000 });
  scheduleSave();
}

/** Drop every cached signed URL — both the in-memory map and the persisted
 *  copy. Called on sign-out / account switch: these URLs point into PRIVATE
 *  reel/post buckets and stay valid for their full TTL, so they must not
 *  survive a change of identity on the device. */
export function clearSignedUrlCache(): void {
  MEM.clear();
  hydrated = false; // let a later session re-hydrate from a fresh write
  try { localStorage.removeItem(LS_KEY); } catch { /* storage unavailable */ }
}

/** The localStorage key backing this cache, so clearLocalAppData can list it
 *  among the keys it purges. */
export const SIGNED_URL_CACHE_LS_KEY = LS_KEY;
