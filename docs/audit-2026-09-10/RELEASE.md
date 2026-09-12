# Audit release — September 10, 2026

## Website deployed

Committed the tested application changes from Batches 1–8 as `4ff0d8d4026e932d27991508ef1c914f426df6b6` and pushed the existing `main` production branch. Vercel reports a successful deployment. `https://grubbyrater.com` now serves the new release.

The public repository commit includes source, regression tests, dependencies and the migrations already applied during earlier batches. Local audit reports, screenshots and device diagnostics were not included in that commit.

Verification:

- Production returns HTTP 200 and the configured Content-Security-Policy, Referrer-Policy, X-Content-Type-Options and X-Frame-Options headers. CSP remains the limited policy documented in Batch 1, not a completed full source allowlist.
- Production CSS matches the final local build (`index-BN9VJJrr.css`). Production JavaScript is `index-Di_icMVF.js`; local/native is `index-BTzi50fT.js`. Environment-specific builds need not have identical JavaScript hashes. The production bundle contains the new photo signing, failed-search recovery, native metadata and incremental evidence code.
- Production Home exposed 64 storage image elements, all using signed paths, with zero public paths or broken loaded images. Some offscreen images were still lazy and not yet loaded.
- Direct public guide route and gallery rendered successfully. With the gallery open, all 92 storage image elements had loaded, used signed paths and had no broken images. Advanced from photo 1 to photo 2 of 30, confirmed the second image loaded, and closed the gallery. No publishing, rating, follow or other account writes were made.
- Initial browser navigation actions were inconclusive, and one gallery click returned a computer-use dispatch timeout even though the subsequent state confirmed it opened. Do not interpret those tool outcomes as a measured app navigation failure or a clean whole-app interaction pass. Public guide direct loading and gallery advancement were verified.
- Focused release photo suite: 29 tests across four files passed (policy, reader, rendered image and cache-isolation fixtures). The unchanged release also retains Batch 8's complete 1,563-test passing run and production build.

## Physical iPhone waiting for unlock

Built the audited source successfully for physical iOS using the existing development signing configuration. App: `/tmp/goodeats-audit-device-build/Build/Products/Debug-iphoneos/App.app`, bundle `com.tylergorin.restaurantapp`, version 1.2/build 1. Its packaged web asset paths match the verified local build.

Selected Tyler’s iPhone 16 Pro, iOS 27.0 beta. Device was paired and available over local network, but installation failed because the developer disk image could not be mounted while the phone was locked (`kAMDMobileImageMounterDeviceLocked`). This was a device-lock failure, not an automatic approval rejection. No uninstall/data erase occurred. Asked the user to unlock and keep the phone awake, preferably connected by USB.

Resume by installing the prepared signed app, verifying launch and the native photo flows, and checking offline/reconnect, owner photos, editing/sharing and account changes using a suitable test account. Installation/launch alone does not complete this checklist.

## Photo privacy enforcement still pending

The live `photos` and `avatars` buckets remain public; `reels-videos` remains private. Rechecked photo/legacy-avatar policies. An anonymous RLS-only aggregate query saw 528 photos and no avatar objects, demonstrating that the prepared policy restricts this listing; that result does not disable public-URL access.

Do not treat S4 as closed. No bucket flags were changed during this release step. Complete compatible-client checks before applying `photo-privacy-cutover.sql`, then verify anonymous denial for private objects and continued public/owner/follower access for authorized references. Existing downloaded bytes cannot be recalled by changing a bucket flag.

## Subsequent Batch 9 release

Commit `1247ce4` was deployed successfully after the original release above. Website and both simulators include the location pagination/recovery fixes; production partial failure → Retry recovered from 4 to 62 visible rows. The prepared signed physical app was rebuilt with Batch 9 as well, but physical installation/verification and photo-bucket enforcement remain pending. See BATCH-9.md for details.

## Batch 10 release

Commit `50d31ecab9dbbf5d24a2fde4d1f0448ea883a998` pushed to main. Vercel success confirmed. Production browser serves `/assets/index-9DDK10kX.js` and `/assets/index-BCfSPOEo.css`; guest home renders populated community content with no returned error-level console logs. Seven editor imports are deferred; details in BATCH-10.md.

Both iPhone 17 Pro simulators have the refreshed build (iOS 26.4 and 26.5). Signed physical-device build refreshed successfully but physical installation remains pending. No photo bucket cutover performed.

## Supabase platform upgrade — September 11

Enabled leaked-password protection and completed the user-authorized stable database upgrade to 17.6.1.166. Project returned ACTIVE_HEALTHY; post-upgrade physical backup dated 10:46:14 UTC completed. Both targeted security advisories cleared. Live schema/policy/migration/cron baselines and guest web/API/photo/Auth-interface/Realtime-connection checks passed. No app source changes or deployment needed for these platform changes. See PLATFORM-HARDENING.md for scope, evidence and remaining audit items.

## Batch 11 release

Commit `da35afb497011d313f0a0f461e4eb47d3daafadc` deployed successfully through main. Production entry `/assets/index-DwZe8iQC.js`; all five security headers exactly match vercel.json and the served inline theme script is authorized by its SHA-256 hash. Live migration `20260911012044_audit_function_paths_and_rate_limit_access` has matching local/history versions. Both simulators are updated and launched; signed physical-device build refreshed, installation pending. Platform settings and photo cutover were not changed.

## Batch 12 — physical installation and photo cutover

The Batch 11 app is now installed and launched on Tyler's iPhone 16 Pro. Startup diagnostics passed, including absence of the earlier metadata-save warning. User confirmed gallery, own photos, avatar and relaunch worked. Live migration `20260911112640_audit_photo_privacy_cutover` sets photos and avatars private. Shared signed reads succeed, direct public URLs and private legacy-photo signing are denied, and the fresh website photo smoke check passed. Final post-cutover phone confirmation is pending. Local commit `148ae9b` contains the migration; automatic approval review blocked pushing main pending explicit authorization. See BATCH-12.md.

Follow-up: user authorization received and `148ae9b` pushed to main successfully. The separate Batch 13 legacy RPC restriction is prepared/tested but awaiting explicit permission after automatic review rejected its production application.

## Batch 13 — legacy RPC restriction

Explicit approval received; live migration `20260911122353_audit_retire_legacy_data_rpcs` applied and verified. All nine targeted legacy RPCs deny anon/authenticated execution while preserving service_role access. Nine focused regression tests and live API/Auth/Realtime/photo checks passed. Commit `68f3c5c` pushed to main; automatic Vercel deployment initially pending. See BATCH-13.md for validation and remaining scope.

Vercel subsequently confirmed successful deployment of 68f3c5c.

## Batch 14 — private review readers and internal statistics

User explicitly approved applying and publishing the prepared restriction. Migration `20260911135801_audit_private_review_reader_access` is live and verified: nine direct client entry points restricted, active wrappers preserved. Fourteen regression tests and live anonymous-denial, leaderboard, Auth, public-data, Realtime and sampled signed-photo checks passed. Commit `492600a` published to main; Vercel confirmed successful deployment. No iPhone rebuild required. See BATCH-14.md for remaining scope.


## Batch 15 — September 11 final audit release

Commit `0d320df` pushed to `main`. Four matching database migrations and the current AI, billing and Mux Edge Functions are live. All 47 approved legacy endpoint replacements are live and independently returned HTTP 410. Nine authenticated entry points returned HTTP 401 without a session; guest playback-token returned the expected HTTP 503 because signing keys are absent. Anonymous app-data SELECT returned zero rows.

Full suite: 1,640 tests across 182 files passed. The final guest video authorization adjustment also passed all nine focused privacy tests. TypeScript/security-bootstrap/production build passed. Entry JavaScript is 533.14 kB gzip, about 63% below the pre-batch entry bundle.

Final native build `/tmp/goodeats-final-audit-simulator/Build/Products/Debug-iphonesimulator/App.app` installed successfully on simulator `C1948426-38A2-4886-933A-3DC6C89303DC` and launched as process 30199. This confirms build/install/start, not frame pacing or physical-device behavior. Native UI access was unavailable; the final surface inventory additionally reported the Mac locked.

Dedicated test-account browser CRUD and cleanup are recorded in BATCH-15.md. The unrelated AppDelegate.swift working-tree change and all private audit notes were excluded from the source commit.

Vercel confirmed successful deployment of `0d320df`. Production serves `/assets/index-BrWvU6sP.js` and `/assets/index-Tuj3Kyck.css`; both Home and the entry script returned HTTP 200. The live Home DOM rendered reels, guides and navigation, and all four image elements loaded with zero broken images. Returned browser error logs were historical local-preview errors, not evidence of a fresh production error. The exact configured-header check is recorded in final-production-release.json. Mux dashboard sign-in is still required for signing-key setup. StoreKit sandbox purchase/restore, actual new media uploads, multi-account social interactions and physical-device accessibility/offline/frame-pacing checks remain unverified.

## Batch 16 — September 12

Mux signing is configured and real private photo/video uploads, signed playback, follow approval/removal, and two-account messages have been exercised. Commits 9be5186, a168db6 and 5ab6d42 were deployed successfully. Token-renewal follow-up 736d510 is publishing. Full suite: 1,667 tests/186 files passed; production build passed. Temporary second account and social fixtures were removed, preserving the original nine test-account ratings. See BATCH-16.md for final release/cleanup confirmation and the remaining native purchase/accessibility/frame-pacing limits. Earlier statements above that Mux signing keys are missing are superseded.

Final Batch 16 confirmation: 736d510 deployed successfully. Production serves /assets/index-DNsK1bxA.js; fresh private-video playback passed and the recreated fixture was deleted through the app. All temporary accounts/media/social fixtures are removed; nine original test-account ratings remain. Final simulator build installed and launched successfully (PID 53727). See BATCH-16.md for remaining device verification and explicitly scoped UX/legacy-client limits.


September 12 physical-device update: rebuilt commit 736d510, synchronized Capacitor, signed successfully, and verified packaged web assets match the fresh dist build. Installed in place on Tyler’s iPhone 16 Pro over the paired wireless connection, then launched successfully. Version 1.2/build 1, entry index-DHcY8Woc.js. No uninstall or app-data reset. This confirms installation and launch; StoreKit and physical accessibility/frame-pacing checks remain separate. Evidence: physical-latest-install-sep12.json.


Batch 17, September 12: session persistence and interaction fixes deployed in commit 620559f (live entry index-DKuMOyI4.js). Full suite 1,684 tests/189 files passed. Signed device build installed in place on Tyler’s iPhone 16 Pro (index-JKsV0J7B.js), launch blocked by iOS Locked pending unlock. Live two-session test confirms local sign-out revokes only the selected session. See BATCH-17.md for remaining physical performance/inactivity validation.

Batch 18, September 12: `7eba385` deployed successfully (live entry `index-CYCXzpFO.js`). Home spacing increased; detail code/data reuse, immediate native glass retirement, stable header mounting and cover-first paged photo loading implemented. Browser gallery QA passed with 41 photos. Full suite passed 1,689 tests plus the isolated rerun of its single timed-out database test. Build/signature checks passed; updated app installed in place on Tyler's iPhone 16 Pro. Launch blocked by locked device. See BATCH-18.md for evidence and remaining physical transition verification.

Batch 19, September 12: `b0cb949` deployed successfully (live entry `index-DE-5K476.js`). Reproduced and fixed mid-pull photo-loading interruption, deferred thumbnail work until the reveal settles, and suppressed pointer/touch focus highlighting while retaining keyboard outlines. All 29 focused tests and build/signature checks passed. Installed in place on Tyler's iPhone 16 Pro; automatic approval review blocked launch pending unlock. See BATCH-19.md.

Batch 20, September 12: `027419a` deployed successfully (live entry `index-LhVRA_dv.js`). Home search now uses the canonical Search page and location control, avoids the separate sheet entrance and preserves pulls across Home updates. Eighteen focused tests, browser QA and production/native build checks passed. Signed update installed in place on Tyler's iPhone 16 Pro. Physical swipe smoothness remains to be checked. See BATCH-20.md.

Batch 21, September 12: `02f43fd` deployed successfully. Unified native/static web/React startup branding, introduced a reduced-motion-aware loading rail, and aligned launch/web-view background colors. Light/dark previews, production build, native build, signature and packaged asset checks passed. Installed in place on Tyler's iPhone 16 Pro. See BATCH-21.md for verification limits.

Batch 22, September 12: `6246ced` deployed successfully. App ships fully free with retained billing infrastructure/designs behind the shared subscription release switch. Existing server gates disabled; authenticated production checkout returns 409 subscriptions_disabled and unauthenticated checkout still returns 401. Full suite 1,699 tests plus three new server tests, builds, signature/assets checks, and targeted browser checks passed. Signed update installed in place on Tyler's iPhone 16 Pro. Re-enabling instructions: docs/subscriptions.md. See BATCH-22.md.


September 12 release preparation: version 1.3 build 2 corrects the global assistant CSS dependency and restores the Home floating launcher. Commit `2e7b37d` deployed successfully to Vercel. Twenty-three focused tests, production build, live AI response in the rebuilt preview, archive build, signature, app/widget version and 218 packaged web-file comparisons passed. The local archive is `artifacts/GoodEats-1.3-build-2.xcarchive`; the owner handles App Store Connect upload and submission. No archive has been uploaded by the agent.
