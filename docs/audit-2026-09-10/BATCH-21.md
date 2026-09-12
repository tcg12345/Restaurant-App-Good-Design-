# Batch 21 — startup design

September 12, 2026. Source commit `02f43fd`.

Replaced the session/profile bootstrap's generic list skeleton with a GoodEats launch surface: mint bowl mark, wordmark, Good food. Good company. tagline and subtle indeterminate loading rail. Static index markup and a small early stylesheet show the same design before JavaScript executes. No forced loading duration or percentage. Reduced Motion disables the rail animation; a single accessible status names startup.

Native LaunchScreen now uses a vector asset and centered constraints rather than the legacy full-screen orange-logo bitmap. Light/dark launch colors and the native web-view backing match the app's #f8f8f8/#18191b surfaces. Ordinary page-loading skeletons remain separate.

Validation: light and dark static boot previews inspected at 393x852, including full-screen geometry, 84px logo and status label. Browser viewport override reset. TypeScript, security-policy prebuild, production build, Xcode device build and code signature verification passed. Packaged index.html and launch.css matched the build. No new automated tests for this visual change. Native cold-launch appearance remains a physical-device check; the last device launch prerequisite is still an unlock reply.

Unrelated AppDelegate whitespace and all private audit notes excluded from commit. Preview files remain outside the repository in /tmp/goodeats-launch-preview.

Vercel confirmed successful deployment. The signed native build (entry index-Dhivc_R_.js) installed in place on Tyler's iPhone 16 Pro, preserving data. Installation evidence: /tmp/goodeats-launch-phone-install.json. Launch not retried while the earlier locked-device prerequisite remains unresolved.
