# Fifth implementation batch — September 10, 2026

This batch implements a native persistence fix for the restaurant-metadata quota failure (P2) and the first startup bundle reduction (P1). Changes are local; no website deployment, physical iPhone installation or server change was performed.

## Native metadata persistence

The metadata blob contains both disposable restaurant display rows and durable `__` records: recipes/home meals, cook photos, preferences, review archives and deletion information. Treating all of it as an evictable cache would lose user data. The previous quota fallback also stripped inline images from every nested record.

- Signed-in native clients now store this blob through the existing Capacitor Filesystem plugin in the app's Library directory, outside WKWebView localStorage's quota. Files are scoped to the authenticated user ID. [Capacitor Filesystem reference](https://capacitorjs.com/docs/apis/filesystem).
- Two alternating versioned snapshots retain a previous complete copy if a write is interrupted. Reads validate ownership and format. If neither existing copy is readable, the app keeps its in-memory/legacy data, reports the failure and avoids overwriting the unreadable files as if they were empty.
- Writes serialize and coalesce same-tick updates. Account changes discard stale reads/writes; sign-out, account-switch reload and account deletion wait for queued native cleanup. No real account deletion was used for testing.
- Migration reads the legacy metadata and removes its localStorage duplicate only after a confirmed native write. Once native data exists, a leftover legacy duplicate cannot overwrite newer edits. Metadata hydrates before cloud merging; home-meal recovery respects deletion records.
- Persisted restaurant display rows are limited to 400 entries and 512 KiB, favoring recently refreshed entries. Inline images in those disposable rows are stripped. Every `__` record and its inline photos remain intact and outside that eviction budget. Ratings and wishlist records are separate and are not evicted by this policy.
- Web clients also bound the disposable portion. If a web metadata write still exceeds quota, the previous stored copy remains intact; the metadata fallback no longer strips durable recipe/review photos.
- Native read/write failures produce an offline-save warning with an error icon rather than claiming persistence succeeded. Data remains available in memory, and ordinary write failures can retry on a subsequent save.

This is not a migration of every app store. Ratings, visit-history primary storage, drafts and other existing localStorage keys remain separate. It does not recover data already lost before the fix. Physical disk exhaustion can still prevent a write, and terminating the app before an asynchronous write finishes can lose the latest unsaved changes. A corrupt-read protection state requires reopening/recovery before disk writes resume. Device testing remains necessary.

## Startup loading

Converted 36 secondary route bindings to deferred imports, including lists/profile, calendar, restaurant details, recipes, guides, social pages and administrative screens. A shared page loader keeps navigation mounted, shows an accessible loading state, respects reduced motion for its spinner and offers retry after an import failure. The existing retained route/tab infrastructure remains in place.

| Initial asset | Batch 4 | Batch 5 | Reduction |
| --- | --- | --- | --- |
| Main JavaScript, raw | 6.58 MB | 5.42 MB | about 18% |
| Main JavaScript, gzip | 1.864 MB | 1.555 MB | about 17% |
| Main CSS, raw | 1.069 MB | 0.713 MB | about 33% |
| Main CSS, gzip | 0.165 MB | 0.108 MB | about 35% |

These are production artifact sizes, not measured device launch times. Deferred code/styles are downloaded when needed on web and remain bundled as local assets in iOS. Shared dependencies still load initially; SearchMain remains eager through the Home search overlay, despite its route binding being deferred. The main bundle remains large, and global composers/maps/providers are future splitting candidates. The Michelin dataset was already lazy and is unchanged.

## Validation

- **1,525 tests passed across 164 files**, including 15 new regressions: `batch5-tests.log`.
- Persistence fixtures cover a photo payload over 6 MiB, cache bounds, preserved reserved records, relaunch, blocked migration cleanup/stale legacy data, coalescing, edits during hydration, failed writes and retries, unreadable files, interrupted snapshots, ownership checks, account switches and queued cleanup. Filesystem calls use an isolated mock backend; these are not physical-device disk tests.
- Loader tests cover pending imports with navigation still visible, prop delivery and retry after a rejected import.
- TypeScript and production build passed: `batch5-build.log`. The existing large-chunk warning remains.
- Capacitor sync and iOS Simulator build passed: `batch5-ios-sync.log`, `batch5-ios-build.log`. Existing filesystem privacy-manifest coverage was checked; no new native dependency was added.
- Production browser at 390 × 844: direct Calendar loading displayed the loader and resolved to the calendar; changing September to October worked. Search loaded map markers and restaurant results. Hey Thai's sheet and deferred detail page opened. Repeat navigation returned to a usable Search page. Home-to-Calendar navigation worked after the page settled. Initial automation clicks immediately after onboarding did not navigate until a reload; cold-start interaction timing remains a device/browser profiling follow-up.
- The previously recorded PostHog client-rate-limit warnings reappeared during navigation. Analytics event volume is still unresolved. No claim of a warning-free full-app walkthrough is made.

## Remaining work

1. Install the new build on the physical iPhone and verify same-account relaunch, offline metadata/meal recovery, account switching and sign-out cleanup with disposable test data. Inspect safe size/status diagnostics rather than extracting real user databases or tokens.
2. Release the compatible web/iOS clients and perform the coordinated photo bucket cutover from BATCH-3.md. Public photo downloads are still enabled.
3. Profile cold-start interaction readiness and native frame pacing; defer heavy global composers/maps next based on the remaining bundle composition. Measure first useful interaction rather than inferring speed from byte counts.
4. Reduce analytics event volume and make ranking-evidence sync incremental, then continue shared visual consistency and authenticated end-to-end coverage.
