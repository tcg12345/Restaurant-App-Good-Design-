# Batch 7 — incremental preference sync and calendar consistency

Implemented September 10, 2026. This batch addresses the repeated full-history network work in P3 and a focused portion of U6. The displayed H2H algorithm, scores, raw observations and causal links are unchanged.

## Incremental private evidence sync

The client formerly fetched every historical event on every save/foreground/reconnect/minute poll. It now requests `sync_position > remoteCursor`, in owner-filtered pages of 500. Each page is merged with the latest local journal and checkpointed in the same localStorage write as its cursor. A quota error therefore cannot advance past events that were not stored. Empty polls do not rewrite the history. Uploads remain immutable, duplicate-safe batches of 50, with acknowledgement after success and captured-owner cancellation checks.

The additive migration `20260910192158_audit_ranking_incremental_sync.sql` is live on the linked Supabase project. It backfills the four existing records, adds an indexed per-owner cursor, and stamps subsequent inserts in a private trigger. A private per-owner clock row is updated within the inserting transaction. The row lock lasts until commit: another upload for that owner cannot allocate a later visible position ahead of an earlier uncommitted transaction. Independent owners use independent rows. Client-provided cursor values are overwritten; gaps from ignored duplicates are harmless. Old clients can still insert without specifying the new column.

A plain timestamp or global sequence would not provide this commit-order guarantee. See [PostgreSQL row locking](https://www.postgresql.org/docs/current/explicit-locking.html#LOCKING-ROWS). Trusted maintenance must preserve cursor/clock consistency; do not independently reset clocks or reuse old positions.

### Safety and performance checks

- Local fixtures cover migration backfill, unchanged evidence, old-client inserts, forged cursor replacement, duplicate retry, owner isolation, anonymous denial, prohibited counter/function access, rollback and account-deletion cleanup.
- Client fixtures cover 500-row paging, reverse UUID/client-time order, resumed checkpoints, failed downloads/local writes/acknowledgements, local saves arriving mid-request, causal heads, malformed cursors and account cancellation.
- A fictional 5,000-event history returns only five new rows for a five-event delta and uses `ranking_evidence_owner_position_idx` under owner RLS. This is a query-shape/index check, not a production latency benchmark or a multi-session stress test.
- Live verification: **4 of 4 events assigned positions, no clocks behind, identical aggregate evidence checksum before and after**. No synthetic user records were inserted into production.
- Live grants still deny anonymous evidence reads and client updates; private clock reads and direct trigger calls are denied. Both tables have RLS enabled, and the trigger fixes its search path.
- Security advisor WARN counts are unchanged. One additional [RLS-without-policy INFO notice](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) is expected for the deliberately client-inaccessible private clock table. Do not add a public/owner policy solely to silence it. Existing platform/password warnings remain outstanding.

The complete local journal still grows with history and is parsed/serialized when real changes occur. This batch removes repeated full-history downloads and no-op rewrites; it does not yet move preference evidence to an asynchronous per-record local store or compact its causal graph. First sync on a new/cleared device still downloads the complete history. Existing local quota/sign-out loss limits remain as documented in `docs/ranking-preference-recording.md`.

## Calendar design and controls

- Calendar/editor headings share the surrounding sans-serif hierarchy; the isolated display-serif step heading is removed.
- Calendar primary actions and the editor use shared primary/on-primary theme tokens.
- Editor supporting copy and plan-choice descriptions are larger; time/people/form inputs use 16px text.
- Close controls and people +/- buttons have 44 × 44 targets, including removal of a mobile override that was shrinking the buttons.
- Calendar dialog transitions and action spinners respect reduced-motion CSS in addition to the existing sheet-motion handling.

Production-preview verification in dark mode at 390 × 844 and 320 × 740: opened a plan, entered a fictional name, continued to details, changed the party size from two to three, opened the custom-time field, checked computed 16px fields/44px targets and absence of horizontal overflow, then closed without saving. Both step layouts were visually inspected. This is a focused calendar pass, not a completed whole-app light/dark/large-text audit. Two external Places fetch errors appeared in background work; they did not block the form and are retained as an outstanding network-diagnostics item.

## Validation and delivery

- Full suite: **1,550 tests across 167 files passed**.
- Focused ranking suite: **33 tests passed**, including actual migrations in PGlite.
- TypeScript and production builds passed. Native Capacitor sync and simulator build logs are adjacent to this document.
- No package updates and no website deployment in this batch. Photo-bucket privacy cutover remains pending compatible website and physical-iPhone release.

Final UI check confirmed the calendar's Add a plan and editor's Continue controls have identical computed primary/background colors. The verified build was installed without uninstalling/erasing data on both already-running iPhone 17 Pro simulators (iOS 26.4 and 26.5); both app launches succeeded. This confirms delivery/launch, not a complete native signed-in walkthrough or physical-iPhone verification.
