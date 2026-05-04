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
