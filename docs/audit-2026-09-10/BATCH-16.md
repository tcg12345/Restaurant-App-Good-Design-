# Batch 16 — live media and two-account verification (September 12)

## Changes

- Configured Mux signing keys in Supabase secrets. No signing keys, passwords, or access tokens are stored in this report or repository.
- Reproduced a real private-video upload stuck processing: deployed mux-webhook v11 expected a bare row UUID while the upload initializer sent owner:row. Deployed the current owner-bound webhook, with retryable database failures and verified provider ownership.
- Tightened playback signing and visibility changes to verify Mux asset ownership against provider-controlled passthrough. Removed client-writable asset/upload-ID lookup fallbacks. Legacy bare UUID ownership is restricted to reels.
- Added and deployed delete-media. It verifies ownership, cancels pending uploads or removes completed hosted assets, removes owned Storage objects, and deletes app rows only after successful provider cleanup. New clients use this path for media deletion and cancellation.
- Reproduced Follow failing because ON CONFLICT UPDATE requested identity-column privileges that had already been revoked. Changed follow writes to conflict-safe INSERT/DO NOTHING; declined requests can be retried without rewriting identities.
- Added a restrictive follow INSERT policy. Correction to the initial finding: an existing guard_friend_accept trigger already rejects self-approved private follows (live HTTP 400); no successful production approval bypass was demonstrated. The new RLS policy adds defense in depth. The UI now requests approval for every private profile, including verified profiles, matching the existing trigger.
- Reproduced stale private-media counts after following. Follow changes now refresh media, remove revoked private items immediately, clear signed-media caches, and reject in-flight pages from an older access state.
- Added an explicit reload recovery for a tab kept open across deployments when a hashed page module no longer exists. Normal page errors retain local Retry behavior.
- Fixed singular recipe servings and the public-account switch's accessible label.
- Found that long-lived players held 15-minute playback tokens without renewing them. Nearby signed players now renew two minutes before expiry and on resume, ignore responses from an old access state, and offer Retry rather than mounting an unauthorized player. Public and distant players do not request signed tokens.

## Verification

- Full suite: 1,667 tests across 186 files passed. Includes SQL-backed follow grant/consent tests, provider ownership and deletion tests, media-cache revocation, and clock-controlled long-session token renewal.
- TypeScript, security-bootstrap validation, and production Vite build passed. Existing large-bundle and Apple sign-in sourcemap warnings remain.
- Fresh synthetic private video: real upload, real Mux webhook, signed policy, owner playback and thumbnail HTTP 200, unsigned playback and thumbnail HTTP 403, guest row hidden and guest token request denied. Browser owner and accepted-follower playback confirmed with the native video element playing, readyState 4, and no media error during those checks.
- Private photo: real Storage upload and signed owner read, guest signing denied, public URL denied. Owner and accepted-follower browser images loaded.
- Disposable second account created through Supabase Auth with an example.invalid email and auto-confirm; no email invitation was sent. Completed onboarding and privacy settings.
- Second account followed the original test account. Private photo/reel counts changed 0 -> 1 after follow and 1 -> 0 after unfollow without reloading on release 5ab6d42. Direct private reel navigation after unfollow did not expose either test caption.
- Primary account could send a pending private follow request but could not insert an accepted one or approve its own request. Recipient approved it in the app; database status confirmed accepted.
- One test message sent from the disposable account, read by the primary account through its normal authenticated API; a reply sent and visibly received. Guest read denied and spoofed sender insertion rejected by RLS.
- Final service smoke: all 47 retired endpoints return 410; ten active authenticated endpoints return 401 without Authorization; guest empty playback-token request returns 200 with zero tokens; anonymous user_app_data reveals zero rows.
- Security advisors retain the same prior baseline: 15 intentional no-policy internal tables, 53 anon and 64 authenticated SECURITY DEFINER inventory notices, and pg_trgm in public. These are inventory findings, not reproduced exploit counts. See Batch 15's review and https://supabase.com/docs/guides/database/database-linter for remediation guidance.

## Cleanup

- Temporary account signed out; auth.sessions confirmed zero before deletion. Deleted the disposable Auth user through the dashboard; Auth user and profile counts confirmed zero.
- Temporary follows, conversation, messages, and related notifications removed. Original test account retains all nine pre-existing ratings.
- Both media fixtures deleted through delete-media, with app-row disappearance and Storage-object removal independently confirmed. A second synthetic video was then recreated solely to verify the final token-renewal release; its final cleanup is recorded below.
- No real users were followed or messaged. No purchases or bookings were made. Unrelated AppDelegate.swift whitespace and private audit notes were excluded from commits.

## Remaining limits

- StoreKit sandbox purchase/restore is not yet exercised. Automated billing checks do not replace that integration.
- Native UI permission remains pending, so final VoiceOver, actual device offline/resume behavior, and measured frame pacing are not certified. Simulator build/install/launch is a narrower check.
- Unauthorized private deep links currently fall back to the public feed rather than showing an explicit unavailable message; privacy checks passed, but this remains a navigation UX improvement.
- Older installed clients may still use legacy direct media-row deletion until updated. This batch does not claim to remove every historical orphaned provider asset.
- An intermittent background-player authorization error was observed before the renewal change. Token expiry and denied-token rendering are now covered by tests; full device playback across sleep/long sessions remains a device verification item.

## Final release and cleanup confirmation

- Final commit 736d510 deployed successfully on Vercel. Production entry /assets/index-DNsK1bxA.js and homepage returned HTTP 200; sampled configured CSP, Referrer-Policy and X-Content-Type-Options headers matched exactly.
- Fresh final-release private reel visibly played (paused=false, readyState=4, currentTime advancing, error=null); no authorization error appeared. Renewal timing itself was validated with fake-clock tests, not a 15-minute physical-device session.
- Deleted the recreated video through the final production app's Delete reel confirmation. Database independently confirmed zero temporary reel rows, zero temporary post rows, zero temporary Auth users, and the original nine test-account ratings unchanged. The initial synthetic photo's Storage object was separately confirmed absent. Hosted deletion succeeded through the ownership-checked delete-media path; the audit did not independently inspect eventual CDN cache eviction.
- Final iPhone simulator build succeeded, installed, and launched as process 53727 on C1948426-38A2-4886-933A-3DC6C89303DC. The host reports an unrelated missing old iOS 26.0 runtime, but installation and launch of this selected simulator succeeded. This is not certification of physical-device frame pacing.
- Automatic approval review initially rejected an unauthenticated delete-media smoke request. Source inspection established that missing Authorization returns 401 before parsing or any resource lookup; the evidence-backed retry was approved and returned 401. A later read-only public-header check hit review timeout once; its permitted retry succeeded. Nothing remains blocked by those reviews.
