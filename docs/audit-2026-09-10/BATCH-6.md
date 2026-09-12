# Batch 6 — skeletons, prepared navigation, and analytics traffic

Implemented September 10, 2026, following simulator feedback about blank loading screens.

## Loading and navigation

- Replaced the route-level spinner and startup/profile-hydration logo-only screens with a shared content skeleton. List, detail, profile and calendar shapes use surface/ink theme tokens, accessible status text, and motion-safe pulse animation.
- Replaced additional full-page/content-only spinners in recipes, guides, expert discovery, user profiles, reviews, follow lists, calendar plans, activity, verification, conversation recovery and empty map/search results. Existing content remains visible during search refresh. Action-button progress indicators remain appropriate feedback for an action in progress.
- Lazy routes expose a deduplicated preload operation and render synchronously once warmed. A rejected background preload does not poison the later foreground attempt; navigation still has a retry boundary.
- Search, Lists, Profile, Messages, Calendar and text Search code preloads in staggered idle work after the user reaches the app. Search mounts in the background; Lists and Profile also prepare for signed-in users. The existing account-level providers already load calendar/chat/list data. Main retained tabs keep their instances and scroll state after opening.
- The current tab now renders on the first route render, rather than waiting for an effect to add it to the retained list.
- Hidden Search/Lists/Profile layers isolate their URL parameters. Explicit activity guards prevent background tabs from changing navbar visibility or publishing the assistant context. Home continues receiving the real route so its media activity can stop when covered.
- Work is cancelled when the identity/readiness effect changes. Hidden documents defer optional preparation. Preparation does not await or delay a navigation action.

This is preparation, not a promise that every network response is immediate. An early first tap, offline launch, expired image URL or uncached detail may still need a skeleton. Maps/media are not all mounted globally; Messages/Calendar use preloaded code and their existing shared data/cache paths rather than a new always-mounted conversation/player.

## Next audit item: PostHog capture rate warnings

The client previously mirrored every result, impression and API event to PostHog, including large startup result pools and buffered bursts. The installed SDK enforces a capture budget before its before-send callback, so filtering there would be too late.

- API requests, restaurant-returned/seen and feature-seen records remain in the existing first-party analytics collector; they are no longer duplicated into PostHog.
- Product interaction events still mirror to PostHog. Delivery is paced at five events per second with a ten-event initial burst, using a bounded queue that prioritizes business actions.
- The SDK limiter remains enabled. The startup queue drains through the same paced path; account changes and opt-out clear buffered events.
- No server schema or analytics report changes. Existing collector limits/offline retention still apply; this is not an unlimited durable analytics journal.

Reference checked: [PostHog JavaScript configuration](https://posthog.com/docs/libraries/js/config), plus the installed 1.428.3 SDK capture/rate-limiter source.

## Verification

- Full suite: **1,536 tests across 166 files passed**, including new coverage for warmed imports without fallback insertion, offline-preload recovery, staged/cancelled/hidden-document preparation, retained URL/account isolation, paced mirror backlogs, prioritization, opt-out, and preserving detailed collector records.
- Focused suite after final presentation changes: **24 tests passed**. TypeScript and production build passed.
- Main JS: 5,421.53 kB raw / 1,556.29 kB gzip. Startup remains large; prefetch is not a measured first-frame speedup.
- Capacitor sync and iOS simulator build succeeded; logs are adjacent to this file. No dependency changes.
- Production preview at 390 × 844: Home loaded, hidden Search was already mounted without a pending route skeleton before the first tap, Search showed 50 markers/results, Home return retained the map, Calendar opened with controls, and guest Lists opened the intended top-layer sign-in form.
- The actual detail skeleton was rendered separately with the production stylesheet and visually inspected at phone size. The temporary preview-only HTML/JS was removed before Capacitor sync.
- PostHog rate-limit warnings did not recur during this walkthrough. Four Places fetch exceptions appeared during an earlier reload/viewport change; subsequent Search results loaded, and no new errors appeared in the final-bundle walkthrough. This does not establish universal network reliability.

## Remaining audit/release work

Signed-in real-device interactions, memory/frame pacing while tabs prepare, disk-exhaustion/relaunch behavior, purchase/restore flows, platform security settings, ranking full-history sync, and the remaining visual/control consistency inventory are still pending. Website/physical iPhone release and the coordinated photo-bucket privacy cutover remain separate outstanding work.

Simulator delivery: installed the verified app without uninstalling/erasing data on both already-booted iPhone 17 Pro simulators (iOS 26.4 and 26.5). Both app launches returned successfully. This is launch verification, not a complete native signed-in walkthrough.
