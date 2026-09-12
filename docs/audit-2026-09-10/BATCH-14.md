# Batch 14 — review reader privacy (applied and verified)

September 11, 2026. Continues the remaining definer-function audit after Batch 13.

## Confirmed findings

Eight legacy review signatures in four function groups (get_friend_rating_stats, get_friend_reviews_for_place, get_restaurant_community_stats, get_restaurant_reviews) are directly executable by anon/authenticated. The friend readers trust caller-supplied requesting_user_id. Restaurant readers combine private legacy restaurant data without profile visibility filtering. No current src, Edge Function or script callers were found; no scheduled-job references or catalog dependencies were found. Database source search found no other routine callers of these groups.

The active taste_user_stats_impl() helper also retains explicit client EXECUTE despite migration 083 describing it as internal and revoking PUBLIC. It reads per-user statistics across private community ratings. The active leaderboard applies can_view_author after calling this helper, while direct helper access skips that filter. Other callers are definer wrappers (get_taste_benchmarks, get_taste_my_ranks, get_taste_twins_core); their permissions and bodies are not being changed.

Exact deployed code-only definitions are in the new private-review-functions.json fixture. No production private data was requested to demonstrate these vulnerabilities, and no actual exploitation is claimed.

## Prepared change

CLI-created migration `20260911135801_audit_private_review_reader_access.sql` removes PUBLIC, anon and authenticated execution for all overloads of the four retired groups plus the internal taste helper. This is nine existing signatures in total. It preserves trusted server access (already present), function bodies, owner calls, public wrapper access, and app data. Missing legacy functions are skipped on clean installations.

## Validation

Five new PGlite regression tests use exact deployed reader/helper/leaderboard/personal-rank/scalar definitions and fictional records. They demonstrate private notes, photo references, friend aggregates and current private user statistics escaping RLS before the restriction; then verify all nine exact ACLs and denied unambiguous calls for anon/authenticated. Active leaderboard visibility and personal ranks are unchanged through definer wrappers, service-role access and definitions are preserved, and the migration is repeatable/clean-install compatible.

The existing single-argument get_restaurant_community_stats call is ambiguous because the other overloads have defaults. Its precise ACL is tested; the test does not pretend that ambiguous invocation reaches the function body. No obsolete SQL behavior was altered to facilitate a reproduction.

Final focused security run: **14 tests / 3 files passed**, including Batches 11 and 13 tests. The migration and new files pass scoped whitespace checks. Current Supabase advisor 0028 documentation and the previously fetched current-day changelog were reviewed. One initial read-only definition request hit an automatic review timeout; its explicitly allowed retry succeeded.

## Production application and publication

The initial automatic approval rejection was resolved by the user's explicit approval to apply and publish this batch. Applied live migration `20260911135801_audit_private_review_reader_access`; aligned the local migration filename and test reference with authoritative database history. All nine target signatures deny anon/authenticated execution and preserve service_role execution; public leaderboard and personal-rank wrapper grants remain intact.

Re-ran 14 tests / 3 files: all passed in 1.95 seconds. Live anonymous API probes for all five groups returned 401 / 42501 with fictional parameters. The public leaderboard returned 200. Auth health/settings and public community reads returned 200; anonymous Realtime subscribed. All seven sampled shared photos returned signed range reads 206 and direct-public denial 400. These checks made no application data writes and did not test signed-in production CRUD.

Security advisor counts changed from 75 to 66 anonymous definer warnings and 86 to 77 authenticated definer warnings. Fourteen RLS/no-policy informational findings and the public extension warning remain. This batch does not complete the broader security/interaction audit.

Commit `492600a` contains only the migration, code-only fixture and regression tests. Production deployment status is recorded in RELEASE.md. No native rebuild is needed because only database access grants changed.
