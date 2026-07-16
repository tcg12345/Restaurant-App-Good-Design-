// Client-side API keys, read exclusively from Vite env vars — never hardcode
// keys here or anywhere else in the repo. Set them in .env.local (see
// .env.example). Both keys ship in the browser bundle, so they must be
// referrer-restricted in the Google Cloud / Mapbox consoles.
export const GOOGLE_PLACES_KEY: string = import.meta.env.VITE_GOOGLE_PLACES_KEY || '';
export const MAPBOX_TOKEN: string = import.meta.env.VITE_MAPBOX_TOKEN || '';

if (!GOOGLE_PLACES_KEY) {
  console.error(
    '[keys] VITE_GOOGLE_PLACES_KEY is not set — restaurant search and place details will not work. Add it to .env.local.',
  );
}
if (!MAPBOX_TOKEN) {
  console.error(
    '[keys] VITE_MAPBOX_TOKEN is not set — maps, geocoding and directions will not work. Add it to .env.local.',
  );
}
