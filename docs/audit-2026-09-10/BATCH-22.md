# Batch 22 — fully free release (September 12, 2026)

User authorized turning off all subscriptions while retaining infrastructure and design. Commit `6246ced` preserves all products, billing screens, SDK, reconciliation, receipts and grants behind a shared build/deploy switch. The app grants full feature access without plan initialization; Pro tags, upsells, settings and routes are hidden. Purchase/restore/portal calls are guarded. Existing service usage limits and auth/privacy enforcement remain.

Production billing_settings.gates_enabled changed true -> false. Read-only verification under a synthetic request user with no subscription/grant returned is_pro=false and effective_plan=pro, gates_enabled=false. No profile had plan=pro at inspection. This action does not cancel provider subscriptions or invalidate old issued checkout URLs.

billing-checkout deployed with the shared switch disabled. Live unauthenticated POST: HTTP 401. Authorized dedicated test-account POST: HTTP 409, subscriptions_disabled, no purchase needed. Its temporary test session was revoked locally (204), preserving other sessions. No customer or checkout creation occurs before the disabled guard.

Validation: TypeScript passed. Full Vitest suite 1,699 tests/192 files passed, plus three new checkout-handler tests passed separately. Existing paid-path tests run with the switch enabled; free native/web calls and providers have dedicated coverage. Production build, Capacitor sync, Xcode device build, code signature and packaged index match passed. Browser QA confirmed /pro redirects Home, signed-in /settings/subscription renders the normal settings index without a subscription entry, and Help omits restore-purchase FAQ.

Signed app installed in place on Tyler's iPhone 16 Pro; no uninstall or data reset. Install evidence /tmp/goodeats-free-phone-install.json. Native launch not attempted because the earlier device-lock approval block has not been cleared. App Store archive/submission is separate; no claim of App Store approval or physical performance certification.

Public re-enable procedure: docs/subscriptions.md. Unrelated AppDelegate whitespace and private audit notes excluded from commit.

Final release: Vercel reports success for 6246ced. Production browser navigation to /pro rendered Home. Temporary local-preview test account signed out; existing production browser session preserved.
