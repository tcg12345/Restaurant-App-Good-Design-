# Onboarding redesign

The first-launch flow is now: welcome → app goal → home city → cuisines → everyday budget → atmosphere → editable review → account → profile. A returning user can sign in from the welcome header; guests can explore without an account. The Pro walkthrough is no longer a required part of creating an account; Pro remains available in the app.

The screens share the app’s stone and slate theme tokens, system typography, fixed primary actions, and an independently scrolling content area. Inputs use stable DOM fields with persistent labels, a visible focus state, 16px text, autofill hints, and inline validation. Cuisine search stays visible and includes aliases and an expandable full list. City suggestions scroll with the content instead of being clipped in a floating overlay. Step changes reset scroll and announce the new heading without opening the keyboard. Transitions and press feedback respect Reduce Motion.

Personalization uses existing recommendation signals: city affinity, cuisine priors, dominant everyday price and optional occasion price, and atmosphere tags. The eating-preferences question has been removed from both onboarding paths; previously saved preferences are preserved. The preview uses those same signals. Preferences are optional, and `completedSteps` records intentional skips as well as answered questions. The post-auth route is frozen at entry and asks only missing questions, including for legacy profiles without completion metadata. An all-skipped draft survives storage and is not treated as missing data.

Taste data remains in the existing JSON profile column; no database migration is required. Guests keep a local draft. Profile setup requires a confirmed account update and reports remote failures with the draft retained for retry.

## Review locally

Run `npm run dev -- --port 3011`, then open `/scripts/onboarding-preview.html`. The development-only entry offers Taste, Account and Profile views and a light/dark toggle. It is excluded from the production Vite entry and uses the default unauthenticated context. The production flow can be tested at `/` on a fresh local origin.

## Validation

- Production TypeScript and Vite build.
- Full Vitest suite; targeted tests cover skipped-question handoff, legacy profiles, local draft sanitization, complete remote writes, zero-row/failed writes, and recommendation signals.
- Browser walkthrough at 393 × 852: city lookup, alias search, multiple cuisines, budget/atmosphere selection, atmosphere completion, summary editing, reload persistence and account handoff.
- Light/dark visual checks; 320 × 568 scrolling and 393 × 500 form reachability.
- The development profile preview confirms one remaining account step after completing or skipping the preference flow.
- Live account creation, real OTP delivery and OAuth were not exercised.
- Capacitor iOS sync and native iOS Simulator build passed. Native keyboard occlusion also accounts for the pinned onboarding footer.

## App goal step

The first question offers Find great restaurants, Cook something good, or A little of both. Shared native radio cards support touch, keyboard navigation, VoiceOver, light/dark themes, and reduced motion. The answer is optional, editable from the review screen, saved as `taste_profile.goal`, and carried into account setup without a duplicate question.

Home uses the goal to prioritize restaurant discovery or recipe suggestions. Both and skipped answers preserve the balanced ordering; neither mode hides other features. Focused persistence, handoff and Home ranking tests (31 tests) and the production TypeScript/Vite build passed. Visual verification of this new step was unavailable because the Mac was locked; the browser checks above predate this addition.
