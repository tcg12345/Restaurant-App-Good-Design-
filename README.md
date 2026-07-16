<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/31ad99e5-bd54-46f3-82a2-8e823d21b58c

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Copy `.env.example` to `.env.local` and fill in `VITE_SUPABASE_URL`,
   `VITE_SUPABASE_ANON_KEY`, `VITE_GOOGLE_PLACES_KEY` and `VITE_MAPBOX_TOKEN`
3. Run the app:
   `npm run dev`

## Security note: rotate previously committed keys

Earlier revisions of this repo had a Google Places API key and a Mapbox
public token committed in source (split into string fragments). Treat both
as compromised:

- **Google Places key** — rotate it in the Google Cloud console
  (APIs & Services → Credentials), and restrict the replacement by HTTP
  referrer and to the Places API only.
- **Mapbox token** — rotate it in the Mapbox console (Account → Tokens),
  and restrict the replacement to your app's allowed URLs.

Keys are now read exclusively from `.env.local` (see `.env.example`), which
is gitignored — never commit real keys.
