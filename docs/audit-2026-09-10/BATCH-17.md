# Session persistence and interaction polish — September 12, 2026

User reports actual sign-in screen after inactivity, slow Home card/feed, unreliable photos and navigation flicker.

## Verified configuration

Read production Supabase Auth Sessions dashboard: single-session enforcement disabled; time-box 0 (never); inactivity timeout 0 (never); access tokens 3600 seconds; refresh-token replay protection enabled, reuse interval 10 seconds. No server settings changed.

## Fixes

- Ordinary sign-out now uses local scope, preserving other devices' sessions.
- Native session storage serializes reads/writes and retains a write-ahead intent if the Preferences bridge fails. A rotated refresh token cannot lose to the old native copy on a subsequent read/relaunch; failed removal retains a tombstone instead of reviving a revoked session.
- Auth bootstrap and initial events share one profile load. Repeated sign-in/token-refresh events preserve identity/profile. A late bootstrap/profile response cannot overwrite sign-out. Badge/admin probes run independently of the profile gate; failures still preserve the existing-profile retry screen.
- Home can choose a stable useful card from cached data before cloud sync finishes. Failed sync with an empty cache eventually shows generic inspiration without falsely declaring a new account or freezing that temporary fallback.
- Home prepares the feed after its first paint, retaining it across visits. Feed content and author queries run in parallel; ratings/meals/posts can render independently. Engagement metadata is nonblocking, refresh preserves content, empty-state suggestions wait for all primary sources, and people suggestions do not wait for post signing.
- Rating-strip/header/filter rendering uses stable element types. Metadata updates no longer remount rating cards and reset their images.
- Managed photos retry transient signing failures before emitting an error to their parent; offline placeholders await reconnection. Images default to asynchronous decoding. Existing viewer authorization and cache invalidation remain enforced.
- Native glass sampling shares ancestor style reads within a frame, preserving opacity updates on subsequent frames.

## Validation

- Full suite: 1,684 tests / 189 files pass. New regressions cover local logout, token-refresh identity stability, bootstrap races, native token rotation/removal bridge failures, Home cached/failed-sync behavior, feed preparation, progressive feed and card node retention, transient photo recovery, and per-frame style reuse.
- Production build and security policy bootstrap pass. Existing large-chunk warnings remain.
- Fresh Capacitor sync and signed physical-device build pass. codesign verification and packaged web index comparison pass.
- Installed in place on Tyler’s iPhone 16 Pro, preserving data. Entry: index-JKsV0J7B.js. Launch attempt blocked by iOS Locked; unlock requested.
- Live auth integration: created two independent sessions for the authorized test account. Local sign-out revoked the first session's refresh token, while the second session refreshed successfully. Both temporary sessions were signed out locally afterward. No other sessions were revoked.
- Website commit `620559f` deployed successfully; live entry `index-DKuMOyI4.js`.
- Browser inspected current local production bundle and public community feed. The localhost sign-in form automation was inconclusive and is not counted as a sign-in pass. Production verification succeeded with the pre-existing signed-in test session: reload to Profile restored testapp and its nine original ratings; Home → Explore feed → Lists → Search → Home retained the populated feed, and Back to Home preserved the same card. Feed image check: 66 storage images, nine loaded, zero failed loaded images, zero public storage paths; remaining images were lazy. No runtime errors were reported, but four optional Places location-backfill requests failed with network errors; cached labels still rendered. These warnings are recorded, not counted as resolved provider reliability.

No new database migrations or account-content writes. Unrelated AppDelegate whitespace and private audit reports excluded from the source commit.

## Limits

No elapsed multi-day physical-device inactivity test or measured physical frame-time result yet. These targeted fixes are not a claim of flawless performance across the entire app. StoreKit and physical accessibility verification from Batch 16 remain separate.
