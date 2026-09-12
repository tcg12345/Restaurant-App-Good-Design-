# First implementation batch — September 10, 2026

The first batch addresses the exposed legacy database operations, unauthenticated legacy AI spending paths, billing retry loss, and a set of visible interface defects. The full audit remains in README.md; this file records implementation status separately so historical evidence stays clear.

## Live server changes

- **S1/S2:** Applied migration `audit_legacy_access_and_billing_atomicity`. All overloads of the 11 named legacy readers/linking functions now deny PUBLIC, anon and authenticated execution; service_role retains access. Current app source has no callers. A live grants query confirmed all 11 are restricted.
- **S3:** Deployed non-spending 410 tombstones for `determine-cuisine` and `perplexity-restaurant-info`, with gateway JWT checks enabled. Unauthenticated requests to both return 401. Their current app replacements are unchanged.
- **R1:** Deployed billing-webhook version 7 and a service-only, SECURITY INVOKER `apply_billing_event` transaction. Receipt insertion, all plan writes, and a completion marker commit together. Missing profiles or any failed write roll everything back. Concurrent duplicates serialize on the receipt row; only completed receipts suppress retries. Old receipts intentionally have no completion marker, so a redelivery can recover a previously unapplied event. No historical events were replayed against production during this batch.

The live billing endpoint still rejects requests without its configured RevenueCat secret (verified 401). Tests use fictional accounts; no purchases or user entitlements were changed to test this deployment.

## Application changes implemented locally

- **U1:** Sign-in uses the browser top layer above the presenting restaurant sheet. It owns scrolling, focus and keyboard navigation through its exit animation, hides the background from assistive interaction, restores prior focus on cancellation, and respects reduced motion. Sign-in before rating remains required.
- **U3:** Restaurant detail, location and user-profile maps select the app's dark/light map style. Location/profile theme updates preserve their existing camera and DOM markers. The restaurant detail locator can remount because it is decorative.
- **U4:** Experts empty state retains a page heading and uses readable secondary text; the cuisine-filter empty state was also improved.
- **U5:** Removed the viewport zoom restriction and enlarged plan search/detail input text and the mobile placeholder.
- **U2, partial:** Guests skip the authenticated guide-save-count RPC instead of issuing a request that will fail. Expert-schema and cuisine-cache warnings remain separate work.
- **S8, partial:** Vercel configuration now sets nosniff, referrer policy, frame protection, and a limited CSP for framing/base/object restrictions. Full script/connect/source CSP tightening remains to be evaluated separately.

These application/header changes are in the working tree and production build output. They have **not** been deployed to the website or installed as a new iPhone build in this batch.

## Validation

- Full suite: **1,419 tests passed across 154 files**.
- Four new security/billing regressions execute real SQL in PGlite and the actual webhook handler with an isolated database adapter. They cover anonymous/authenticated denial, complete rollback on partial transfer failure, retry recovery, duplicate handling, and repair of an older incomplete receipt. They do not simulate simultaneous independent Postgres connections.
- Targeted billing and bottom-sheet checks passed alongside those tests.
- Final production build and TypeScript validation completed successfully; see `fixes-build.log`.
- Local mobile browser: the sign-in input is visible, receives taps, and is in the top layer. Close-button cancellation and a single keyboard Escape restore the restaurant sheet and the Rate button focus. The actual accessibility tree exposes sign-in while the background is inert.
- Restaurant detail shows a dark locator map in dark mode. Experts empty state displays its heading and readable copy. Plan editor input and placeholder both compute to 16px, and submitting an empty form still shows its validation message. Saved screenshots: `sign-in-fixed.png`, `restaurant-map-fixed.png`, `experts-fixed.png`, `plan-form-fixed.png`.
- Live grants and unauthenticated endpoint checks passed. Post-change security advisors show the anonymous-executable definer inventory reduced from 96 to 85, and authenticated from 107 to 96. These are inventory counts, not counts of confirmed remaining vulnerabilities. [Supabase grant review guidance](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable).

## Next batches

1. Private media storage migration and safe recipe URL fetching (S4/S5), including compatibility and failure-path tests before deployment.
2. Discovery view access, dependency/database patches, leaked-password protection, expert schema and cuisine cache reconciliation (S6/S7/U2).
3. Native metadata persistence, route/bundle splitting and incremental evidence sync, with measured performance before/after (P1/P2/P3).
4. Shared visual patterns and authenticated/device coverage, including native animations, offline/reconnect, keyboard, large text, reduced motion, purchase sandbox/restore, and account switching.

No claim of a completed full-app security or performance cleanup is implied by this first batch. In particular, private media and recipe fetching remain priority findings, and older out-of-order billing events still need a dedicated reconciliation/ordering design.

## Subsequent work

The second batch is recorded in [BATCH-2.md](BATCH-2.md), including live recipe-fetch and reel-storage changes, public-query fixes, validation, and the remaining coordinated photo-privacy rollout.

The third batch is recorded in [BATCH-3.md](BATCH-3.md): compatible photo readers, account cache isolation, live photo access preparation, and successful web/iOS simulator builds. Public photo downloads remain enabled until the coordinated client release and bucket cutover.

The fourth batch is recorded in [BATCH-4.md](BATCH-4.md): live legacy discovery-view containment, compatible dependency patches reducing the npm advisory scan to zero, 1,510 passing tests, and verified production web/iOS simulator builds.

The fifth batch is recorded in [BATCH-5.md](BATCH-5.md): native metadata snapshots with bounded disposable cache rows, deferred secondary routes, approximately 18% smaller entry JavaScript and 33% smaller entry CSS, plus 1,525 passing tests. Physical-device persistence and startup measurements remain pending.

The sixth batch is recorded in [BATCH-6.md](BATCH-6.md): content skeletons instead of blank route spinners, staged preparation of navigation destinations with hidden-page safeguards, and bounded PostHog mirroring that preserves detailed first-party analytics. Validation: 1,536 passing tests, web build, Capacitor sync, and iOS simulator build.

The seventh batch is recorded in [BATCH-7.md](BATCH-7.md): live additive support for incremental preference sync with atomic client checkpoints and a commit-ordered owner cursor, plus calendar typography/control consistency. Existing evidence checksums and owner-only access are verified; 1,550 tests pass. Growing local evidence storage, broader visual review and physical-device/release checks remain open.

The eighth batch is recorded in [BATCH-8.md](BATCH-8.md): search outage recovery without poisoned empty-result caches or unnecessary query expansion, a retained-results Retry notice, and readable calendar controls on narrow phones. Validation: 1,563 passing tests, production build, and updated iOS 26.4/26.5 simulators. The underlying external fetch failure and paginated-search failure handling remain open.

The ninth batch is recorded in [BATCH-9.md](BATCH-9.md): retryable paginated location search, successful-page checkpoints, navigation cancellation, cache-scope safeguards, and location/map skeleton and error states. Validation: 1,573 tests, a 41→95-result load/reload/map walkthrough, and refreshed simulator installations. Live signed-in data-changing coverage remains pending a suitable test account.

The tenth batch is recorded in [BATCH-10.md](BATCH-10.md): seven optional editors moved out of startup with cancellable skeletons, import retry, preserved editor lifetimes and Create-page preparation. Shared guide/recipe styles now load independently of editors. Main JS is 9.17% smaller; 1,580 tests pass; both simulators were refreshed.

The eleventh batch is recorded in [BATCH-11.md](BATCH-11.md): live server-only access for an unsafe legacy rate-limit helper, 14 search-path warnings cleared, enforced browser script restrictions, and privacy-safe diagnostics for a report-only connection policy. Validation: 1,591 tests, web/native builds, live migration/headers, browser map/video/sign-in checks. Hosted password protection and database patching await dashboard sign-in.
