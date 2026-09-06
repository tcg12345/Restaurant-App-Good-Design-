# Onboarding audit — September 5, 2026

## Delivered flow

Welcome → optional cuisine, budget, and city preferences → real recommendation preview → Apple, Google, email, or phone authentication → one profile screen → unanswered preferences and optional dietary choices → visual Pro walkthrough and optional plan selection → Home.

Guests can explore from the welcome screen or recommendation preview. After the profile is saved, “Finish setup” goes directly into the app. Imports, following, rating, verification requests, and the feature tour no longer interrupt signup; their existing app entry points remain available. The separate recap has been removed. The Pro flow now uses three visual feature pages (recipes, assistant, taste insights), followed by plan selection, with a free exit on every page.

## Findings and changes

| Finding | Change |
| --- | --- |
| Setup repeatedly asks for information and delays access to the app | Combined name and username; skip known preferences; removed mandatory first-action screens and tour |
| Desktop and mobile have different setup behavior | Use the same responsive authentication and profile flow |
| Decorative typography, heavy shadows, and slow blur effects make setup feel dated | System typography, quieter surfaces, shorter entrances, clear hierarchy, reduced-motion support |
| Fixed viewport sizing can hide actions behind the native keyboard | Shared shell uses the app’s keyboard-aware viewport height; long content remains scrollable |
| Backtracking past the saved profile discards edits; city changes can be lost | Re-save identity edits and city changes, persist the current city with taste preferences, save again on completion |
| Repeated submit or Enter actions can start multiple authentication or save requests | Synchronous request guards with failure recovery |
| Recommendation preview can retain stale results or wait indefinitely | Reload for changed answers, ignore stale responses, handle errors, and end loading after 12 seconds |
| City lookup failure silently moves forward | Keep the city step open with a recoverable error and an explicit skip |
| Pro presentation and trial claims | Three visual benefit pages and a plan page; full billing period amount; native trials only when store eligibility is confirmed; no web trial promise based on static defaults |
| Native offers can load before billing is configured | Serialize configuration, wait before offers, retry loading, and check the signed-in billing identity before purchase/restore |
| A successful SDK call is treated as proof of access | Confirm the plan with the server; otherwise show pending access without another purchase CTA |
| Web checkout may be blocked by popup timing and never update its originating screen | Open the checkout tab during the click, close it on failure, show blocked-popup recovery, and check for server confirmation |
| Three purchase surfaces maintain divergent behavior | Shared purchase hook for onboarding, Pro page, and feature paywalls |
| Pending work and success timers can outlive the screen | Cleanup timers, ignore stale offer responses, and bound automatic status checks |

## Validation

- Production build and TypeScript check pass; existing large-bundle warnings remain.
- Full suite: 55 files, 889 tests passing, including 11 new billing regression cases.
- Browser checks at 375×667, 390×844, 430×932, and desktop: welcome, preference navigation, profile editing, Pro offer, and free completion into Home.
- Mocked auth: duplicate submit sends one OTP; resend cooldown; invalid-code recovery; successful verification; password validation; transition into profile setup.
- Visual walkthrough checked at three iPhone sizes: all four pages fit, navigation works through buttons and page indicators, and “Continue free” remains reachable.
- Mocked checkout: monthly selection, service failure and retry, opened checkout, pending state, and confirmed Pro access.
- Browser tests use intercepted services: no real accounts, contact uploads, or charges.

## Release verification

A physical iPhone / StoreKit sandbox pass is still needed for native Apple/Google sign-in, keyboard positioning, trial eligibility, purchase cancellation, restore, and pending-purchase approval. Web prices still come from existing configured app defaults; verify they match the active Stripe price IDs before release. Checkout remains the final authority for web offers. No production billing products or prices were changed.

The flow is shorter and removes identified friction; conversion uplift requires measuring real funnel results after release.

Reference: [RevenueCat trial eligibility](https://www.revenuecat.com/docs/subscription-guidance/subscription-offers), [Capacitor purchase API](https://github.com/RevenueCat/purchases-capacitor), [Supabase password authentication](https://supabase.com/docs/guides/auth/passwords).
