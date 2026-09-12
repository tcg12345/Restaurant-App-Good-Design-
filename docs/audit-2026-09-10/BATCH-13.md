# Batch 13 — retired legacy data RPCs restricted

September 11, 2026. First pushed the user-authorized photo privacy commit `148ae9b` to main successfully.

## Confirmed finding

Nine legacy SECURITY DEFINER functions remain executable by both anon and authenticated. They use the old profiles/restaurants data model, have no current source callers in src, supabase/functions or scripts, and are not referenced by scheduled cron jobs or catalog dependencies. A source-level SQL routine search found only the already restricted auto_link_all_restaurants wrapper; its anon/authenticated access is false and service access true.

Functions: check_email_exists(text), get_cached_friend_activity(uuid,integer,integer), get_friend_profile_with_all_data(uuid,uuid), get_friend_profile_with_pagination(uuid,uuid,integer,integer,integer,integer), get_friends_recent_activity(uuid,integer), rebuild_friend_activity_cache(uuid), link_all_restaurants_systematically(), link_restaurant_by_place_id(text,text), link_restaurants_to_google_places().

Live definitions were captured as code-only fixtures. Against fictional isolated PGlite tables using those exact definitions, anon could check a private email's existence, read another user's cached activity, pass a forged requesting_user_id to access a private profile, and link another account's restaurant rows. No production private-data retrieval or cross-account write was used to reproduce the finding. No evidence of actual exploitation is asserted.

## Applied change and validation

Applied migration `20260911122353_audit_retire_legacy_data_rpcs.sql` revokes PUBLIC/anon/authenticated execution for all overloads of those nine names and preserves trusted service_role execution. It keeps definitions and data in place; absent legacy functions on clean installations are skipped. The initial CLI filename was renamed to the authoritative live history version before commit.

Five regression tests passed. They cover the isolated reproduction, removal of both inherited and explicit client grants across all functions, actual rejected calls as anon/authenticated, preserved service calls and unchanged definitions, repeat execution, and a clean installation with no legacy functions. Current documented Supabase guidance for advisor 0028 was checked.

## Approval and release

The first application was rejected by automatic approval review for lacking explicit permission. The user subsequently explicitly approved applying and publishing this fix; application and push then succeeded. No alternate tool or indirect application was attempted during the blocked period.

Live catalog verification confirms all nine signatures have anon=false, authenticated=false, service_role=true. Both definer advisor groups decreased by nine: anon 84 → 75, authenticated 95 → 86. Other existing categories remained unchanged (14 RLS/no-policy, one public extension). No claim is made that every remaining finding is a vulnerability or that the audit is complete.

Final regression run: **9 tests / 2 files passed**, including the prior rate-limit hardening suite. Live anonymous calls to check_email_exists using a fictional .invalid email and get_cached_friend_activity using the zero UUID returned HTTP 401 / SQLSTATE 42501. No global writer was invoked against production.

Live current-app smoke checks passed: Auth health/settings 200, public ratings read 200, Realtime anonymous subscription succeeded and disconnected, seven shared photo/avatar samples returned 206 via signed URLs and 400 for direct public URLs. No actual signed-in login/write flow was exercised.

Commit **68f3c5c** contains the migration, code-only legacy function fixtures and regression tests; successfully pushed to main. Vercel deployment initially pending. Local audit reports and the user's unrelated AppDelegate.swift edit were excluded. No native app rebuild is needed for this database-only permission change.

Final release status: Vercel reports **success — deployment completed** for commit 68f3c5c.

## Remaining scope

Other exposed definer functions, including additional legacy restaurant/friend review overloads, remain to be individually reviewed. Guarded admin operations were not blindly revoked. The prior post-cutover physical iPhone photo confirmation is still pending; the user's broad continue instruction is not a test result.
