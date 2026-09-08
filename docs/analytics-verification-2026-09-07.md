# Analytics verification — September 7, 2026

The audit checked collection, delivery, access controls, SQL aggregation, and dashboard rendering. The report migration has been applied to the connected Supabase project. The frontend changes still need the normal Git/Vercel deployment; native iOS users need a build containing these changes.

## Fixes

- Restaurant actions carry `data_source`: `google_places`, `own_data`, `mixed`, or `unknown`. The restaurant table expands into counts by source for search selections, returned results, visible impressions, loaded details, saves, removals, ratings, shares, and outbound taps. CSV includes the source breakdown; visitor timelines include the source on individual events.
- Google search/detail adapters identify Google records. Memory-cache hits retain Google provenance and do not create another API request. Bundled Michelin records identify the app's catalog. A catalog-based panel enriched with Google details is marked mixed. Community photos or reviews alone do not reclassify the base restaurant record.
- Direct wishlist removals are now tracked. Duplicate removals and rapid toggles use the latest wishlist state. A save means an addition in this reporting period, not the current number of people who have it saved. Local saves can precede cloud synchronization.
- Buffer saturation preserves important restaurant actions before background API traffic. Batches are bounded by bytes as well as event count so long field masks stay within the collector and keepalive limits.
- Requests retain their initiating page after navigation; an earlier account's in-flight request cannot be attributed to the next account. Telemetry exceptions cannot change fetch responses.
- Reused restaurant DOM nodes can register the newly displayed restaurant. Page and detail visits are deduplicated separately for each account.
- Restaurant ranking preserves the selected metric through aggregation. API rows separate different Google field masks. API-only sessions no longer skew session-quality statistics.
- Visitor pagination recovers from a network rejection and allows retry.

## Verification evidence

| Area | Verification |
| --- | --- |
| Search → seen → selection → details → save/remove | React integration tests use the real ListsProvider and collector queue; verify user, page, source, immediate delivery, and deduplication. |
| Engaged time | Fake-clock test verifies the 60-second idle cutoff and no time accumulation while hidden. |
| Delivery | Retry preserves event IDs; sign-out drains under the current account; account switches, admin exclusion, opt-out, saturation and byte limits tested. |
| Google vs catalog | Actual Google details loader tested twice: one fetch, two Google-sourced results. Michelin conversion and future catalog registration tested. |
| Database | PGlite executes the actual original migration and replacement report, with authenticated/anonymous roles and auth fixtures. All restaurant totals reconcile with their source counts. |
| Overview/pages/features/search/outcomes | SQL fixtures verify visits, distinct visitors, sessions, duration, transitions, exposures/uses, empty searches, coverage and outcome totals. |
| Retention/users | SQL fixtures verify eligible Day 1/7/30 cohorts and 100-row pagination with tied timestamps and no missing/repeated IDs. |
| API/costs | Browser and server tests verify attribution, failures and isolation. SQL fixtures verify field masks, effective rates, unpriced calls and cache exclusions. |
| Access/privacy | Ordinary-user ingestion works; spoofed actors are dropped, retries deduplicate, reads return no rows and owner RPCs reject non-admins. Sanitization, opt-out and private admin routes are tested. |
| Dashboard | Rendering tests cover source expansion, ranking requests, access gating and pagination error recovery. CSV escaping reviewed. |
| Live Supabase | Replacement report executed as the owner; source totals reconcile. Existing sample: 419 API requests, 16 failures, $0.11075 priced estimate, 414 unpriced calls. No synthetic user activity was inserted. Server analytics flag verified enabled; deployed location-chat contains the logger. No analytics-specific security advisor findings. |
| Release checks | Full suite: 1,132 tests passed across 96 test files. Production TypeScript/Vite build passed. Existing bundle-size warning remains. |

The visual browser preview could not be inspected because the desktop was locked. Automated dashboard rendering tests passed. No new live save event or native-device end-to-end run has been verified yet; the live database still contains the earlier sample, with zero saves.

## Data definitions and limits

- Returned means a result delivered by the instrumented search adapter. Seen means at least half of an instrumented card was visible. These are different measurements.
- Search selections currently instrument the main search/recent-search handlers; search outcomes also cover the AI search entry points. Feature exposure measures instrumented visible entry controls. These are not an exhaustive click log of every element in the app.
- Detail visits represent loaded detail data (or a settled panel fallback), not every click that leaves before the details load.
- Data origin is separate from network usage. A Google-sourced save can have zero new Places calls. Search requests serving multiple restaurants remain request-level costs; they are not charged once to every result. Restaurant-specific details/photos are attributed by Places ID.
- Existing events have unknown provenance. No historical sources or missing saves were fabricated. Catalog IDs and Google IDs are not fuzzy-merged by restaurant name.
- Own-catalog loaders added later must set provenance at the data boundary. Adding restaurant rows alone does not bypass the current Google detail loader.
- Client tracking is best effort: opt-out, blockers, offline operation and abrupt process termination can suppress events. Optional PostHog/replay, native SDK traffic and provider bills have not been end-to-end reconciled. Server logging covers the instrumented upstream fetches; it is not an account-wide cloud billing meter.
- Cost figures use configured published rates, excluding free allowances, credits, discounts and unpriced providers. This is a partial estimate, not an invoice.
- Report periods/daily groups use ingestion time; daily groups use UTC. The restaurant ranking is limited to 250 rows, users to 200 most recently active, and visitor history loads in pages of 100.

## After deployment

1. Use a regular account with usage analytics enabled. Search for a restaurant, leave its card visible, open its details, save it once, then remove it once. Stay online briefly before closing the app.
2. On the owner account, refresh Analytics → Restaurants. Expect one new save and one removal, the corresponding visit/impression, and the source in “Data source by action.” Counts are additions to the selected period, so older totals may be higher.
3. Open the visitor timeline to verify the individual actions. Reopen the same details within the memory-cache window: source should remain Google Places, with a cache-hit event and no extra details request if that in-memory cache is still available.
4. When introducing an own-catalog loader, test an own-only result and a Google-enriched result separately using the adapter instructions in owner-analytics-setup.md.
