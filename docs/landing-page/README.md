# GoodEats app landing page

## Entry points

- `/`: marketing landing for new ordinary browser visits.
- `/welcome`: always opens the landing in an ordinary browser, including after entering the web app.
- `/download`: landing with download options open.
- `/app`: enters the existing app at `/` and remembers that choice in session storage so a reload stays in the app.
- `/login`: opens the existing sign-in flow, skipping the taste quiz.
- Native Capacitor and installed standalone/PWA launches enter the app directly.
- Existing restaurant, group, recipe, and other shared routes, OAuth callbacks, and recovery links continue into the app.

The landing is lazy-loaded separately from the app, its styles, authentication providers, and data-fetching contexts. This keeps a marketing visit independent of app initialization. It uses local photographs and existing self-hosted fonts, no added runtime dependencies.

## Downloads

The default download destination is [app ID 6779690841](https://apps.apple.com/app/id6779690841), supplied by the owner. Apple's public lookup verified this ID on September 12, 2026: the live listing is currently named **Gourmet Canvas**, bundle ID `com.tylergorin.restaurantapp`, matching this repository. The country-neutral link continues to work after a name change.

The header, hero, and final download calls to action use Apple's unmodified official badge and link directly to the listing. The footer also links directly. The `/download` route retains download options and web-app access.

`VITE_APP_STORE_URL` can override the destination with another App Store or public TestFlight URL; an unset or blank value uses the supplied ID. Optionally set `VITE_PLAY_STORE_URL`. These are public build-time settings; rebuild after changing them. A TestFlight override uses a beta label, not an App Store badge. Invalid configured URLs are not linked.

Badge asset: [Apple official SVG](https://developer.apple.com/assets/elements/badges/download-on-the-app-store.svg), saved unchanged as `public/images/landing/download-on-the-app-store.svg`. Badge proportions, at least 40 px height, and surrounding clear space are preserved. [Apple marketing guidance](https://developer.apple.com/app-store/marketing/guidelines/).

## Design references

Researched September 12, 2026:

- [Flighty](https://flighty.com): app-first product presentation, prominent download action, short feature narratives.
- [Partiful](https://partiful.com): expressive personality, product demonstrations, both app and web entry paths.
- [Beli](https://beliapp.com): restaurant discovery told through tracking, sharing, and personalized recommendations.

The design uses GoodEats' current forest/mint palette, bowl logo, and Fraunces/Manrope typography. The miniature app interface uses illustrative example content, labeled beside the preview controls. It does not claim fabricated reviews, store ratings, or live restaurant recommendations.

## Real photography

The landing does not use the generated onboarding images. Downloaded local files are derived from real photographer images whose original source pages identify publication dates and camera information:

- `public/images/landing/pasta-alex-froloff.jpg`: [Alex Froloff, pasta and white wine](https://unsplash.com/photos/pasta-dish-on-white-ceramic-plate-gxhiAn41zwo), April 2020, Canon EOS 5D Mark III. [Original image](https://images.unsplash.com/photo-1587649350531-9186b07e1cb6).
- `public/images/landing/restaurant-avi-richards.jpg`: [Avi Richards, The Butcher’s Daughter, Los Angeles](https://unsplash.com/photos/fine-dining-setup-inside-restaurant-prz1uSrxsM4), June 2018, Panasonic DC-GH5. [Original image](https://images.unsplash.com/photo-1530234780129-a2fe8d8cfa0c).

Both are under the free [Unsplash License](https://unsplash.com/license), permitting commercial use and modification. Attribution is appreciated, not required. These photographs are atmospheric marketing imagery, not representations of the illustrative restaurant scores shown in the preview.

## Verification

`npx vitest run src/landing/entry.test.ts src/landing/LandingPage.test.tsx` covers native/PWA bypass, landing and app routing, preservation of deep links and auth callbacks, store URL handling, interactive previews, mobile menu, download dialog, and reduced motion.

Full typechecking on this repository can exceed Node's default 4 GB heap; use `NODE_OPTIONS=--max-old-space-size=8192 npm run build` when needed. Keep the existing Vercel deployment and rewrites: this is an integrated front door for the same app/domain, not a separate replacement site.

## Scroll motion and header

Section entrances are driven by native scroll position through `useLandingMotion`, with a single animation-frame loop and cached layout measurements refreshed on resize or font/layout changes. Only the artwork interpolates; wheel, touch, keyboard, and anchor scrolling stay native. Entrances reverse when scrolling back, while content leaving above the viewport stays readable.

On taller desktop viewports the taste scene pins briefly as the green panel expands and its ranking card tilts. Smaller viewports use ordinary document flow. The header collapses into a floating glass bar, indicates the active section, changes its chapter label, and switches to a dark theme for the taste section. Its reserved layout space prevents jumps when its dimensions change.

Reduced motion disables the pin, transforms, and animated transitions while preserving section tracking and navigation. The scroll listener and any pending frames/resize observers are cleaned up on unmount. Tests also verify header expansion, section tracking, dark/light changes, and changing the motion preference during a visit.
