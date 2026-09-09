# Private ranking preference records

Implemented September 9, 2026, as preparation for the supplemental ranking experiment. This records observations; it does not change personal scores, settlement, ranking choices, community averages, or the UI. No record is currently used by the experimental model or any public score.

## What is recorded

`ranking_preference_events` contains immutable events owned by one authenticated user. Each event has a UUID, capture timestamp, source, affected restaurant IDs, parent version IDs, a numeric-free snapshot of the saved list order, and any explicit comparison answers. The optional `explicitOrder` preserves the H2H placement/manual order instruction separately from the resulting saved order.

- **H2H:** Both restaurant IDs, `preferred`/`not-preferred`/`tie`/`skip`, and the time each answer was entered. The event is committed when the user saves the rating. Undone answers and abandoned/cancelled drafts do not become saved evidence. Ties remain ties; skips provide no preference direction.
- **Slider:** Labeled `slider`. Any H2H tie-break answers are retained under that source, without relabeling a self-picked score as a normal H2H rating.
- **Import:** Labeled `import`; records the resulting saved order without inventing binary answers from it. Importing one row does not establish the provenance of all other items in its order snapshot.
- **Manual reorder:** Records the explicit requested order, saved order, and restaurants whose positions changed.
- **Score edit / visit restoration:** Records the new snapshot and invalidates older comparisons involving the affected restaurant. Promoting a historical visit after deleting the current visit does not pretend that the old visit's missing comparison history is known.
- **Deletion:** Records removal from the current order and retires related preference evidence. Historical observations remain private, with deletion/supersession status; deleting the account cascades to the entire cloud journal.
- **Existing ratings:** An initial snapshot is labeled `legacy`, with no fabricated comparisons. Existing numeric gaps cannot recover past choices or ties.
- **Automatic score settlement:** Provides no new preference votes. Pure numerical normalization that preserves order produces no event. An automatic order change is labeled `system` and does not invalidate explicit judgments.

Editing notes, photos, tags, or other visit details without changing the score or supplying a new comparison draft produces no preference event. A newly supplied H2H draft is recorded even if it happens to produce the same score.

`order` is an observation of the saved score-sorted ladder, with `orderBasis: "persisted-score-order"`. It is **not** a claim that every pair was explicitly compared. At equal stored scores, existing input order is retained in the snapshot; explicit ties are carried independently in `comparisons`. Recording never imposes this snapshot back onto application state.

## Versions and supersession

Every new event references the known current journal heads in `parentIds`. These causal links establish that one observation came after another even when device clocks disagree. UUIDs make retry inserts idempotent. Two offline devices can create separate branches; their records are merged by ID rather than replacing a shared JSON blob.

`resolveRankingEvidence` is a research helper. It preserves all raw observations while marking individual comparisons as `current`, `superseded`, `conflicting`, `skipped`, or `deleted`. A later judgment invalidates older comparisons involving its affected restaurants; it does not discard unrelated users' or restaurants' preferences. Concurrent incompatible evidence is left ambiguous. Multiple snapshot heads produce no single resolved order until a subsequent observation joins them. This resolver is not a ranking algorithm.

## Persistence and access

- Local storage: `goodeats-ranking-evidence:<ownerId>` stores the journal and pending event IDs synchronously. Failed uploads remain pending for retry on reconnect, foreground, or the one-minute retry interval while mounted.
- Cloud: a separate `public.ranking_preference_events` table, keyed by `(user_id, id)`. Uploads use duplicate-ignore inserts in batches of 50. Reads paginate by ID. RLS and grants allow authenticated users to read/append only their own records; anonymous access and client updates/deletes of history are denied.
- Account scope is captured for each sync. Cleanup cancels local merge/acknowledgement after an account switch so a late response does not restore cleared data. Guest events remain local and are not silently assigned to the next person who signs in.
- Rating saves do not wait for the network. Recording errors log a warning and cannot change the score or fail the ordinary rating save. Browser storage clearing, quota failures, or signing out before an upload can still lose unsynced evidence; the existing account cleanup clears local app caches. This is not an archival guarantee for unsaved or unsynced actions.
- Only restaurant IDs and preference metadata are sent to this table, not notes, photos, names, or contacts. There is no community read policy or aggregate endpoint.

The additive migration is `supabase/migrations/20260909233047_ranking_preference_events.sql`, aligned with the version applied to the linked Supabase project (`ocpmhsquwsdaauflbygf`). Its primary key also indexes owner lookups and the account foreign key. No existing table or score calculation is altered. The client retains records locally if the table is unavailable.

Backend verification confirmed enabled RLS, owner-only SELECT/INSERT policies, no anonymous reads or authenticated UPDATE/DELETE grants, and no rows visible without an authenticated identity. The Supabase security advisor returned no findings for this table. The web frontend is released through the repository's normal Vercel deployment from `main`; native app distribution is a separate release.

This initial implementation reads the owner's journal when syncing and stores full order snapshots. It is suitable for collecting early data. Incremental fetching, transactional local storage for concurrent browser tabs, and compact snapshots should be considered before large histories accumulate. Current restaurant identity is the app's existing restaurant ID; cross-provider canonicalization is still a separate audit task.

## Verification

```sh
npx vitest run src/lib/ranking-evidence.test.ts src/lib/ranking-evidence-store.test.ts src/lib/ranking-evidence-security.test.ts src/lib/supabase-ranking-evidence.test.ts src/lib/headToHeadRating.test.ts src/lib/settleScores.test.ts src/lib/applyRatingSave.test.ts src/lib/mergeUserData.test.ts src/components/RatingFlow.test.ts
npm run build
```

Tests exercise real rating-sheet saves for choices/ties/skips, replacing an H2H draft with a slider score, unchanged note-only saves, unchanged H2H outputs when timestamps are attached, causal supersession, concurrent branches, deletions, imports, local reloads, upload retries, saves during uploads, and account isolation. PGlite executes the actual migration to check allowed owner operations, denied cross-account and anonymous access, immutability, malformed rows, duplicate retries, and account-delete cascades.

The offline prototype remains in `scripts/ranking-prototype`. Connecting this journal to it should explicitly select current eligible evidence and account for ties, imports, guest exclusion, restaurant identity, and incomplete overlap. Do not turn every historical event or every snapshot into an independent vote.
