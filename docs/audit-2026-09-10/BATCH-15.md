# Batch 15 — data access, billing, video privacy, startup, and signed-in verification

September 11, 2026. This is the current audit status; earlier batch notes are historical.

## Confirmed issues fixed

- Removed the surviving `Anyone can read app data` SELECT policy. It overrode the intended owner-only policy through PostgreSQL's permissive-policy OR semantics. Private app JSON is now readable only by its owner. The issue was reproduced with synthetic records; other users' private contents were not retrieved and exploitation was not established.
- Retired client access to 21 legacy tables and one view, and 13 deployed legacy RPC signatures. Follow updates can change status but not the identities of the relationship. Nine reaction/comment tables now require visibility of their parent. Active expert and social-suggestion helpers filter private authors.
- Serialized quota checks per user/endpoint. AI quota infrastructure failures now stop paid work with a retryable error instead of allowing it.
- Billing reconciles current RevenueCat subscriber snapshots, uses provider observation timestamps to reject stale updates, and atomically processes transfer receipts and all affected plans. Provider failures remain retryable. No real purchase or paid-user plan changes were performed by the audit.
- Private Mux uploads fail closed without signing configuration. Visibility changes report revocation and metadata errors, reconcile video access before the new client changes row visibility, and no longer claim partial work succeeded. Previously secured playback IDs remain signed when a post is public; public token issuance is available to guests, while private tokens require owner or accepted-follower access. Tokens expire after 15 minutes, and session changes invalidate the local cache and in-flight responses.
- Deployed the previously missing playback-token endpoint. Aggregate inspection found zero existing private Mux videos, so no existing private assets required conversion. Signing keys are still absent; secure private playback remains unavailable until configured.
- With explicit user approval, replaced 47 unused legacy Edge endpoints with inert HTTP 410 handlers. This closes old provider-spending, email/booking, service-role review-reading, and cache-warming paths. No current code calls these endpoints; the current push-dispatch cron is preserved. The deployment was initially rejected by automatic review, then explicitly approved and successfully deployed. Database contents were not deleted.
- Restored missing `trips` and `home_meals` columns, backfilling valid existing metadata mirrors only when a column is first created. Repeated migration execution does not overwrite later edits. This removes missing-column save retries and restores dedicated saves.
- Deferred Discover, search, and the Mux player engine; extracted comments so the social feed no longer pulls in the entire reels route. Entry JavaScript decreased from 1,424.54 kB gzip to 533.14 kB gzip (about 63%). This is entry-bundle size, not a measured guarantee about total downloaded bytes or startup latency.
- Added comments skeletons, reduced-motion handling, list-dialog focus/labels/close targets, and consistent locked-score presentation. Verified the reel comments dialog focuses its Close button and exposes a named composer.
- Fixed manually typed recipe units disappearing when moving to another field, including normalization and clearing. Corrected singular ingredient/step counts.

## Live migrations

- 20260911143112_audit_restore_app_data_privacy
- 20260911145527_audit_billing_reconciliation
- 20260911172911_audit_remaining_access_boundaries
- 20260911183229_audit_restore_optional_app_columns

Local filenames match live history. Live checks confirmed owner-only app-data SELECT, zero client grants on the retired tables/view, status-only follow UPDATE, and no anonymous/authenticated CREATE privilege in public.

## Verification

- Full suite: 1,640 tests passed across 182 files. The final guest/public video authorization adjustment additionally passed all nine focused video privacy tests.
- TypeScript, security bootstrap checks, and production build passed. Existing large deferred-chunk warnings remain.
- All 47 newly retired endpoints returned HTTP 410. Current AI/upload/visibility/billing endpoints rejected unauthenticated requests. Playback-token now deliberately permits public-only issuance to guests; missing signing configuration returns 503.
- Anonymous app-data read returned zero rows. Auth health/settings, public community reads, and Realtime subscription passed. Seven sampled signed photos returned 206 and their old public routes returned 400.
- Dedicated test-account browser checks: sign-in; original nine ratings; custom-list creation, add existing rating, reload and deletion; profile bio edit, reload and restoration; calendar creation, edit, reload and deletion; private manual recipe creation, reload and deletion; reel playback, comments loading and dialog focus; navigation between Home, Lists, Profile and Calendar.
- Temporary audit list, bio, calendar plan and recipe were cleaned up. No messages, follows, bookings, purchases or public test comments were sent. No passwords or tokens are stored in these notes.
- iOS simulator build succeeded, installed and launched. Final asset refresh is tracked in RELEASE.md.

## Remaining limits and external setup

- Mux signing-key provisioning requires the user's Mux dashboard session. A request is pending. Private uploads and visibility changes involving private hosted video safely report unavailability meanwhile.
- Native Computer Use permissions are not granted. Physical-device keyboard, VoiceOver/large text, offline/crash recovery and measured frame pacing are not certified by a successful build or launch. The user's previous photo checks remain useful evidence but do not cover all these cases.
- Real StoreKit sandbox purchase/restore flows, multi-account social/message interactions, and actual new photo/video uploads were not exercised in this browser pass. Isolated authorization and billing tests cover failure cases, but do not replace those integrations.
- Supabase still lists 15 intentional RLS-without-policy private/internal tables, 53 anonymous and 64 authenticated SECURITY DEFINER inventory warnings, and pg_trgm in public. These are not counts of reproduced exploits. Reviewed callable wrappers either enforce access or intentionally expose public data; trigger functions cannot be invoked as ordinary RPCs. Moving pg_trgm also requires updating the legacy link_restaurant_by_place_id search path and was not done indiscriminately. Public-schema CREATE is already denied to app roles.
- Performance advisory counts are not proof of a production slowdown. Do not remove indexes based on prelaunch usage or claim flawless animation without device measurements.

The server and browser fixes are deployed in commit `0d320df`, with Vercel success and production Home/entry checks confirmed. The final simulator build installed and launched. The complete integration audit remains open for the concrete checks above.
