/**
 * iOS WKWebView (the Capacitor app's web view) frequently fails to render
 * large base64 `data:` image URLs — they load fine in a desktop browser but
 * silently break on the phone, which is why community photos "don't show
 * up". Converting them to blob object URLs renders reliably.
 *
 * Extracted from useRestaurantDetail so EVERY surface that renders
 * community photos (the detail page, RestaurantPanel fronting reel/post
 * taps, …) shares one conversion + cache instead of some surfaces
 * rendering raw data: URLs that go blank on iOS. Lives in lib/ so pulling
 * it in doesn't drag the detail page's mapbox-gl dependency along.
 */
import { useEffect, useRef, useState } from 'react';

/** data: URL → blob object URL; null for anything that isn't a data URL so
 *  callers can keep the original. */
export async function dataUrlToBlobUrl(dataUrl: string): Promise<string | null> {
  try {
    if (!dataUrl.startsWith('data:')) return null;
    // fetch() decodes the data URL natively — far faster and more memory-safe
    // than an atob() char-by-char loop, which choked/threw on large photos
    // (so those just vanished from the page).
    const blob = await fetch(dataUrl).then((r) => r.blob());
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
}

/**
 * Convert any base64 photos in `photos` to blob object URLs, returning a
 * map of source data-URL → blob URL. Blobs are cached by their source URL
 * so one already on screen survives partial list swaps; dropped sources are
 * revoked, and everything is revoked on unmount. Non-data URLs are simply
 * absent from the map — render `map[p.url] ?? p.url`.
 */
export function useBlobPhotos(photos: Array<{ url?: string | null }>): Record<string, string> {
  const cacheRef = useRef<Map<string, string>>(new Map());
  const [map, setMap] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    const cache = cacheRef.current;
    (async () => {
      const needed = new Set<string>();
      for (const p of photos) {
        const url = p?.url;
        if (url && url.startsWith('data:')) {
          needed.add(url);
          if (!cache.has(url)) {
            const blob = await dataUrlToBlobUrl(url);
            if (cancelled) { if (blob) URL.revokeObjectURL(blob); return; }
            if (blob) {
              cache.set(url, blob);
              // Publish each as it's ready so grids fill in progressively
              // rather than waiting for the whole batch.
              setMap(Object.fromEntries(cache));
            }
          }
        }
      }
      let changed = false;
      for (const [src, url] of cache) {
        if (!needed.has(src)) { URL.revokeObjectURL(url); cache.delete(src); changed = true; }
      }
      if (changed && !cancelled) setMap(Object.fromEntries(cache));
    })();
    return () => { cancelled = true; };
  }, [photos]);

  // Release every blob when the consuming component unmounts.
  useEffect(() => () => {
    for (const url of cacheRef.current.values()) URL.revokeObjectURL(url);
    cacheRef.current.clear();
  }, []);

  return map;
}
