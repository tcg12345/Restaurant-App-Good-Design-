# Batch 9 — location pagination and recovery

Implemented September 10, 2026. This continues the search reliability audit while the physical-phone release and dedicated test-account walkthrough remain pending.

## Changes

- Paginated Places requests now use the bounded, cancellable search transport. HTTP/network failures and malformed page tokens reject rather than returning a false empty last page. Existing recommendation/assistant callers already handle rejection.
- A new cursor-batch helper snapshots input cursors and checkpoints each successful page together with its results. Failed queries keep their old token and remain available for Retry; successful queries are not unnecessarily repeated. Cancellation prevents the entire old batch from being published.
- Location Load more publishes every completed batch before starting another. Later failures therefore cannot discard rows whose tokens have already advanced. A synchronous in-flight guard prevents repeated taps from starting overlapping pagination loops.
- Location, price, search, taste and account transitions cancel the current pagination session. The previous session cannot advance the new location's cursors, add IDs to its deduplication set, or clear its loading state. Cache writes require the pool's scope to match the current browse scope, preventing old rows from being stored under a new city's key.
- Initial search merges cuisine results that arrived first. Cuisine backfill publishes each completed cuisine before attempting the next and does not mark failed work complete. A retry of failed initial loading can resume cached unfinished cursors instead of taking the same cache shortcut again.
- Location chat/viewport appenders have cancellation guards; a chat search for another city no longer marks those results seen in the current city.
- Location list and desktop map-list initial content use the shared skeleton. Map failure states distinguish outages from a genuine empty result and offer Retry. Small map loading notices now use the theme surface rather than hardcoded white.

## Validation

- **1,573 tests across 168 files passed.** Ten new cases cover paginated HTTP/network/malformed responses, exact page-token retries, partial successes, complete outages, genuine empty final pages, cancellation and successive checkpoints. Focused paging/search suite: 34 tests passed.
- TypeScript and production build passed. Main JS: 5,423.49 kB / 1,557.04 kB gzip. The existing large-chunk warning remains.
- 390 × 844 dark production preview: initial New York list showed 41 restaurants; Load more increased it to 95 and returned to an enabled button. Reloading the final build restored all 95 without a visible loading status. Open map retained the same 95 results; expanded the map list successfully. No horizontal document overflow or console errors in the checked flow.
- Fault and cancellation paths use deterministic fixtures, not a forced live outage. The fixtures cover the paging contract; they do not constitute a complete signed-in app walkthrough or a frame-time benchmark.
- Capacitor sync and simulator build succeeded. Installed without uninstalling/erasing data on both iPhone 17 Pro simulators. Launches succeeded: iOS 26.4 PID 26129 and iOS 26.5 PID 26127.

## Release and remaining work

Commit `1247ce4` was pushed through the existing production branch. Deployment verification is recorded below once complete.

No database, bucket, scoring or billing changes. Public photo download enforcement still awaits compatible physical-phone verification. The dedicated test-account question is pending; no real-user ratings, lists, social data or profiles were changed. The complete existing suite includes isolated authenticated authorization and billing tests, but no new live signed-in CRUD/purchase coverage is claimed.

The underlying external Places fetch failure remains unconfirmed. Legacy text pickers and recommendation/assistant surfaces still use their existing fallback UI; these need further product-level error handling. Viewport search does not persist every supplemental query's page token, so explicitly rerunning that action may repeat successful requests. Broader visual consistency, startup optimization, database review, platform hardening and real-device measurements remain open.

Release verification: Vercel reports commit `1247ce4` successfully deployed. Production serves the new `index-C3ypa5ld.js` entry. The production location page encountered a partial search failure naturally: it displayed four successful rows and “Couldn’t load — try again.” Clicking that control recovered to 62 rows with the normal enabled “Load more restaurants” control. This directly verifies the retained-results/retry presentation in addition to the deterministic fault tests; the underlying external failure cause remains unconfirmed. No production error-level console entries were returned during this check.

The signed physical-iPhone build was also refreshed successfully at `/tmp/goodeats-audit-device-build/Build/Products/Debug-iphoneos/App.app`. It has not been installed on the locked phone. A deployment-status permission review timed out once; the permitted single retry succeeded, so no release action remains blocked by that review.
