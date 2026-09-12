# Batch 8 — search failure recovery and calendar readability

Implemented September 10, 2026. No database, security-policy, dependency or scoring changes in this batch.

## Search reliability

Code inspection found that nearby search converted network/HTTP errors into empty arrays, then interpreted that empty pool as a reason to launch additional billed queries. Text lookups also treated failed requests as empty responses, widened them, and could cache that outcome for five minutes. This explains poor recovery behavior; it does not establish the underlying cause of the external `TypeError: Failed to fetch` errors observed in Batch 7.

- Nearby/text search requests now distinguish failures from successful empty responses and have a 12-second deadline per request, including response-body reading. Caller cancellation propagates and removes listeners/timers when finished.
- Nearby queries retain successful sources during partial failure. A complete failure, or a failed wave whose successful sources returned nothing, rejects rather than replacing the page with an empty pool. A partially failed first wave does not trigger supplemental searches. Successful first-wave results survive failure of the supplemental wave.
- Text lookups validate HTTP status/response shape. Failed requests are not memoized and do not trigger the broad fallback. Successful exact results survive a failed depth supplement without being memoized as a complete pool.
- Text memo keys now include the requested result-depth threshold, preventing a shallow typeahead lookup from satisfying a later recommendation request needing more candidates.
- Discover's nearby and explicit text searches keep the previous results when a request fails and display a theme-aware Retry notice. Cancelled/superseded requests do not display this notice or overwrite newer results. Initial loading retains the existing skeleton pattern.
- Legacy text-picker callers keep their array-returning contract. Their failed searches can recover immediately on another attempt, but they still lack a dedicated error notice. Paginated location searches and other Places helpers are outside this batch and still need the same failure-state review.

No automatic retry loop was introduced. A sparse successful search can still perform two waves, each with its own deadline. Partial results can be smaller than a completely successful search. Request telemetry remains in place; the underlying external failure is not claimed fixed.

## Calendar readability

The editor still had 7–11px supporting text and mobile overrides reducing reservation descriptions to 7.5px. Supporting text now has a 12px floor, while form inputs retain 16px text. Step navigation, clearing/searching/changing the selected place, month arrows and time/duration choices have larger targets (44px height; icon controls 44px square).

Below 360px, date choices use two columns, duration choices use three, reservation choices stack, and the people/header rows may wrap. Larger phones keep the compact grids. The internal scroller and persistent footer accommodate the added text height.

## Verification

- **1,563 tests across 167 files passed.** Thirteen additional Places cases cover HTTP/network/malformed response recovery, cache depth, complete/partial/supplemental failures, filtered searches, cancellation and stalled response-body timeout/retry. Existing calendar behavior tests pass.
- TypeScript and production build passed. Main entry JavaScript: 5,423.69 kB / 1,557.10 kB gzip. The existing large-chunk warning remains; this is not a startup-bundle optimization batch.
- Production preview, dark mode: visually inspected both editor steps at 320 × 740 and reservation/duration controls at 390 × 844. Computed sheet/scroller widths showed no horizontal overflow; reservation descriptions and duration choices use 12px text, with 44px duration targets. Changed a fictional unsaved plan's reservation choice, then dismissed it without creating a plan.
- Reloaded the final build and navigated Calendar → Search → Home → Search. Search displayed 50 results before and after the round trip; the final checks showed no visible loading status or console errors. This is a bounded observation, not a frame-time measurement or proof that external requests never fail.
- Failure paths were exercised with deterministic fetch fixtures. The new Retry notice was reviewed in code; a live network outage was not forced during browser verification. Light appearance, large text, signed-in operations and physical-device offline/keyboard/frame-pacing coverage remain pending.
- Capacitor sync and iOS simulator build succeeded. Installed without uninstalling or erasing data on both running iPhone 17 Pro simulators (iOS 26.4 and 26.5); both launches returned exit code 0.

Website and physical-iPhone deployment were not performed. The coordinated photo-privacy cutover, platform security configuration, broader query review and native performance measurements remain open as documented in the earlier batches.
