# Batch 11 — browser and database hardening

Implemented September 10, 2026 (database migration clock is September 11 UTC). Commit `da35afb497011d313f0a0f461e4eb47d3daafadc`.

## Implemented

- The legacy `check_rate_limit(uuid,text,integer,integer)` SECURITY DEFINER function was executable by both anon and authenticated callers. Its supplied user/window parameters permit changes to another user's limit records, including deletion of current rows with a negative window. Reproduced only against isolated fictional rows using the exact live definition. Public/client EXECUTE is now revoked; service_role access remains.
- Pinned the empty search_path on 15 reviewed functions (14 previously unset, plus the legacy rate helper). All application relation/helper references in those definitions were already schema-qualified. Function bodies, identities, result contracts and trigger registrations were retained. The four SQL regression tests preserve helper results and cuisine trigger behavior under a hostile caller search path.
- Live migration `20260911012044_audit_function_paths_and_rate_limit_access.sql` applied successfully. Initially generated using the CLI and then aligned to the authoritative MCP migration-history version before commit. Post-change metadata confirms anon=false/authenticated=false/service=true for the rate helper. The advisor's 14 mutable-search-path warnings are gone. Live scalar checks returned cuisine cap=3, approved confidence=100, normalized='abc' and the expected UTC AI day boundary.
- Expanded the website's enforced CSP: same-origin/trusted-provider script allowlist; no unrestricted inline JS, inline event handlers, string eval or data/blob script elements. Exact SHA-256 allowance preserves the existing pre-paint theme script. Script hashing is checked by the production build, and Vite preview serves the same headers as production.
- Retained required Mapbox WebAssembly/blob workers, Mux workers and React/Motion inline styles. Font/manifest sources are local; framing, object embedding, base redirection and cross-origin HTML form submission are restricted.
- Images/media/fetches still allow HTTPS to preserve externally imported images, cache/export and direct-upload paths. The narrower connect-src list is report-only. This is not a complete outbound-network boundary.
- Added bounded first-party CSP diagnostics: only fixed provider categories, directives and enforcement/report-only outcomes, maximum 20 unique reports per document. No raw URLs, hostnames, signatures, paths, script samples or user text. Existing analytics opt-out/admin filtering applies. These events are not mirrored to PostHog. Diagnostics start with the bundle, so initial bundle failures require console inspection.

## Verification

- 1,591 tests in 171 files passed; 25 focused tests passed. Eleven new tests cover real SQL permissions/behavior, diagnostic privacy/bounds and policy compatibility. Final migration-path check: four tests passed.
- Test harness corrections were required for Vite HTML asset URL rewriting and PGlite's non-UTC display timezone. Final runs passed.
- Production web build, TypeScript check and bootstrap-policy checker passed. Main JS 4,927.82 kB / 1,424.04 kB gzip; the existing large-chunk warning remains.
- Harmless browser fixture: same-origin script and blob worker ran; unapproved inline script, inline handler, eval and data script were blocked. Temporary fixture removed before Capacitor sync and excluded from commit.
- Production preview: dark guest home loaded; Mapbox rendered 50 results and markers; Mux reel reached readyState 4, playing with no video error; guest Profile action opened the sign-in overlay. No error/warning logs returned in the map/video checks. Full OAuth callback, signed-in uploads and payment completion were not exercised.
- Browser-tool session reset during sign-in checking; fresh tab recovered and the guest gate was verified. Some initial sidebar Map clicks did not produce a stable route; direct navigation rendered correctly. This was inconclusive and is not recorded as a newly reproduced product defect.
- Capacitor sync and simulator build passed. Both simulator installations were updated without uninstalling/erasing data. Launch PIDs: iOS 26.4 38325; iOS 26.5 38311. The signed physical-device build also succeeded but was not installed.
- Vercel reports successful deployment. Production entry `/assets/index-DwZe8iQC.js`. Live response exactly matches all five configured security headers, including enforced CSP and report-only connect-src; the served inline bootstrap matches its authorized hash.

## Remaining security work

The hosted dashboard is signed out. The user was asked to sign in so the supported controls for leaked-password protection and database upgrading can be inspected/applied. No hosted Auth setting, plan purchase or database engine upgrade was performed. Leaked-password protection requires Pro or above; check the current plan before proceeding. Database upgrade eligibility, estimated downtime, prerequisites and recovery/backups must be reviewed in the authenticated dashboard.

Current advisors still report the public pg_trgm extension, 84 anonymous and 95 authenticated SECURITY DEFINER exposure warnings, and 14 informational RLS-without-policy notices. Many exposed functions are deliberate public readers/authenticated RPCs, and private/server tables deliberately deny client rows; the counts are not equivalent to confirmed vulnerabilities. Their full body/authorization inventory remains unfinished. Do not mass-revoke functions or create permissive policies just to remove warnings.

The coordinated photo bucket cutover still awaits physical-client verification. Billing event ordering/reconciliation, full signed-in/device coverage, broader design/accessibility checks and further performance work remain open. Browser CSP headers apply to the website, not the bundled Capacitor document.

References: [Supabase function search paths](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable), [definer exposure](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable), [password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection), [database upgrades](https://supabase.com/docs/guides/platform/upgrading). Browser policy maintenance and vendor requirements are in the tracked docs/browser-security.md.
