import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Google Places photo URLs (v1 places API and the legacy maps API) are billed
// per fetch. The app deliberately disables photo fetching by stripping
// `places.photos` from every Places FieldMask, but old records cached before
// that change still hold these URLs. Rendering them triggers a billed network
// call. Use `safeImage(url)` to coerce any such URL to '' at render and
// data-load time so the browser never requests them.
export function isGooglePlacesPhotoUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return (
    url.includes('places.googleapis.com') ||
    /\/maps\.googleapis\.com\/maps\/api\/place\/photo/i.test(url) ||
    /lh\d+\.googleusercontent\.com\/places/i.test(url)
  );
}

export function safeImage(url: string | null | undefined): string {
  if (!url) return '';
  return isGooglePlacesPhotoUrl(url) ? '' : url;
}

/**
 * Append a `#t=0.1` media fragment so a non-playing `<video>` paints its first
 * frame as a cheap inline poster — even with `preload="metadata"`, where the
 * browser would otherwise show nothing (a long gray/blank tile) until the clip
 * is played or seeked. The fragment is client-side only, so it doesn't touch a
 * signed URL's query token. Use for grid/card thumbnails of videos that have no
 * dedicated poster image.
 */
export function firstFrameSrc(url?: string | null): string | undefined {
  if (!url) return undefined;
  return url.includes('#') ? url : `${url}#t=0.1`;
}

/**
 * Today's (or the given date's) calendar day as `YYYY-MM-DD` in the user's
 * LOCAL timezone. `new Date().toISOString().slice(0, 10)` is UTC — for any
 * user west of UTC rating in the evening, it silently returns TOMORROW's
 * date (and a timestamp converted with it lands on the wrong day).
 */
export function localISODate(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Parse a stored visit/rating date for display. Bare `YYYY-MM-DD` strings are
 * calendar days in the user's LOCAL timezone, but `new Date(s)` /
 * `Date.parse(s)` read them as UTC midnight — which renders as the PREVIOUS
 * day anywhere west of UTC. Anchoring to local noon keeps the calendar day
 * stable in every timezone. Full ISO timestamps parse unchanged. Returns null
 * for empty/unparseable input.
 */
export function parseVisitDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T12:00:00` : s);
  return Number.isNaN(d.getTime()) ? null : d;
}
