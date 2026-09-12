# Fourth implementation batch — September 10, 2026

This batch closes S6, the legacy discovery-view exposure, and patches the npm dependency findings in S7. Platform patching, password protection and the coordinated photo release remain separate work.

## Live database fix

Applied `20260910141350_audit_discovery_view_access.sql` to the hosted project. `profiles_public_search` now uses `security_invoker=true`, so reads follow the caller's base-table row-level policies. Anonymous and PUBLIC access are revoked. Authenticated callers retain SELECT only; unnecessary client write grants were removed. Existing service access is preserved.

The view still returns the same discovery columns and filters for public profiles or those accepting friend requests, but requires signed-in access and cannot broaden the underlying audience. The current app searches `user_profiles` and contains no reference to this legacy view. The migration safely skips newer installations without it and can run repeatedly.

Live verification confirmed anonymous SELECT is false, authenticated SELECT is true, authenticated INSERT/UPDATE/DELETE are false, and service SELECT is true. Head-only API requests returned HTTP 401 for the legacy view and HTTP 200 for the current profile endpoint; no profile contents were retrieved for that check. The Supabase `security_definer_view` ERROR is gone. Other advisor counts are unchanged; counts and remediation URLs are in `batch4-advisors.json`. [Supabase view and RLS guidance](https://supabase.com/docs/guides/database/postgres/row-level-security#views).

## Dependency patches ready locally

The fresh npm audit fell from **17 affected packages to zero known vulnerabilities**. See `batch4-npm-audit-before.json` and `batch4-npm-audit.json`. This is an advisory scan of the resolved npm tree, not a claim that the whole app has no security defects.

| Dependency | Before | After |
| --- | --- | --- |
| React Router / react-router-dom | 7.13.2 | 7.18.3 |
| Vite | 6.4.1 | 6.4.3 |
| Vitest and its matching packages | 4.1.8 | 4.1.11 |
| tar (Capacitor CLI dependency) | 7.5.15 | 7.5.22 |
| protocol-buffers-schema (Mapbox dependency) | 3.6.0 | 3.6.1 |
| ws | 8.20.0 | 8.21.3 |
| @xmldom/xmldom | 0.9.10 | 0.9.12 |
| PostCSS | 8.5.8 | 8.5.28 |

Babel, browserslist, baseline-browser-mapping, nanoid, picomatch, brace-expansion and associated transitive packages also received compatible patches. Redundant vulnerable esbuild entries were removed by dependency resolution; the final Vite tree uses esbuild 0.25.12. No forced major upgrades or dependency overrides were used. Direct router, Vite and Vitest minimums were raised in package.json; exact resolved versions and integrity hashes are recorded in package-lock.json.

The installed npm 10.9.2 crashed twice while resolving the Vitest peer dependency tree. A temporary `npx --yes npm@11.19.1` invocation resolved the targeted updates and completed a clean lockfile install; system npm was not replaced. The existing Apple sign-in patch applied successfully. Capacitor and its native plugin versions are unchanged.

## Validation

- **1,510 tests passed across 161 files**, including five new database tests using the real migration in PGlite. They exercise anonymous denial with and without a supplied identity, signed-in discovery, privacy transitions, owner write denial through the view, narrower future base-table RLS, preserved service reads, repeated deployment and absent legacy schema. See `batch4-tests.log`.
- TypeScript and production build passed: `batch4-build.log`.
- Clean install and existing native patch passed: `batch4-install.log`.
- Capacitor sync and native iOS Simulator build passed: `batch4-ios-sync.log`, `batch4-ios-build.log`.
- Production preview: guest onboarding → Home → Search loaded 50 places and their map markers. Hey Thai's restaurant sheet and full detail route opened; Back returned to Search with its results. The checked flow recorded no console warnings or errors.
- `git diff --check` passed.

The dependency changes are in the working tree, built web assets and synced iOS project. **They have not been deployed to the website or installed on the physical iPhone in this batch.** Only the database migration is live. Browser route checks and a simulator compile do not establish device animation performance or complete signed-in coverage.

## Remaining priorities

1. Release compatible web/iOS readers and complete the photo bucket cutover described in BATCH-3.md. Public photo downloads remain enabled.
2. Address the confirmed native restaurant-metadata cache write failure, then split startup routes/heavy components and measure device startup/navigation. The main bundle is still 6,582 kB raw / 1,864 kB gzip; this batch does not claim a startup speed improvement.
3. Review analytics event volume, incremental ranking-evidence sync and shared visual patterns with targeted behavioral checks.
4. Complete supported database patch planning and leaked-password protection configuration with auth regression coverage. Existing findings remain: [database upgrade guidance](https://supabase.com/docs/guides/platform/upgrading), [password protection guidance](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
