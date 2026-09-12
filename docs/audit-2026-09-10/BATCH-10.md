# Batch 10 — defer optional editors

Implemented September 10, 2026. Commit `50d31ecab9dbbf5d24a2fde4d1f0448ea883a998`.

## Changes

Seven optional interfaces now load separately from startup: restaurant rating, list recipe editing, home meal creation, reel creation, post creation, saved recipe editing and guide creation. Their providers and existing navbar preparation remain in place. Opening Create starts staggered idle preparation of these interfaces; opening an editor directly starts its import immediately.

The shared lazy editor displays a theme-aware form skeleton while downloading. Its native modal dialog stays above existing sheets, keeps keyboard focus inside, supports Escape/backdrop/close dismissal and locks underlying scroll. Import failure offers Retry. An editor closed before download completion does not mount late or consume a draft. A later opening uses current props. Warmed editors render without a placeholder flash; after first actual mounting, editors remain mounted to preserve their existing dismissal animation, completion UI and cleanup behavior.

Two shared style dependencies were uncovered during splitting: GuideRender styles were only imported by the guide creator, and the assistant's recipe draft sheet relied on the home-meal editor's dish styles. These shared components now import their own styles; GuideLiveEditor also owns its CSS import.

## Validation

- 1,580 tests across 169 files passed. Seven new behavior tests cover closed startup, skeleton dismissal, cancelled downloads, current draft props, instance retention, preload deduplication, retry after failure and Escape cancellation.
- Initial test execution hit missing jsdom dialog APIs; explicit dialog stubs fixed the test harness. Final focused and full runs passed.
- TypeScript and production build passed. A subsequent CSS-only ownership correction was production-built and tested again.
- Main JS: 5,423.49 → 4,926.26 kB (9.17% smaller); gzip 1,557.04 → 1,423.49 kB (8.58% smaller). Main CSS is 483.05 kB / 72.42 kB gzip. All seven editor modules are separate chunks. These are bundle measurements, not real-device frame-time or startup timing benchmarks; the large-chunk warning remains.
- Production preview at 390×844: guest home and direct guide reader render without document overflow. The guide's five-place list and hero are styled correctly, with GuideRender CSS loaded independently of the editor. No error-level console entries returned in this checked flow.
- Temporary local fixture (removed after verification): light desktop, light phone and dark phone skeletons render correctly. Phone overlay bounds 390×844; close target 44×44; no horizontal overflow. Close returns focus to the underlying Open editor button. Pending/fault tests use synthetic components and do not establish full signed-in composer end-to-end coverage.
- Capacitor sync and simulator build succeeded. Installed without uninstalling or erasing either simulator. iOS 26.4 launch PID 32694; iOS 26.5 launch PID 32765.

## Release and remaining work

Pushed to the existing production branch; deployment verification follows in RELEASE.md. Local audit artifacts and temporary UI fixtures were excluded from the public commit.

Physical-phone installation/verification and the dedicated signed-in test-account walkthrough remain pending. This batch does not change database access, photo bucket enforcement, rating/scoring or billing behavior. The other outstanding security and performance items remain as recorded in earlier batches, including the coordinated photo cutover, platform hardening, CSP, billing event ordering, device frame-time/memory tests and the full accessibility/design matrix.

Release verification: Vercel reports commit `50d31ec` successfully deployed. Production serves new entry `/assets/index-9DDK10kX.js` and the verified `/assets/index-BCfSPOEo.css`; the guest home populated its normal community content and returned no error-level console entries. Startup styles do not include the deferred editor styles. The signed physical-device build also succeeded at `/tmp/goodeats-audit-device-build/Build/Products/Debug-iphoneos/App.app`; it has not been installed on the phone.
