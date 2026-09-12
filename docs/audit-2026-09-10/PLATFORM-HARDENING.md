# Platform hardening — September 11, 2026

## Completed

At approximately 10:25–10:29 UTC, used the authenticated Supabase dashboard for project `ocpmhsquwsdaauflbygf` (production). Organization is already on Pro.

- Enabled and saved **Prevent use of leaked passwords** in Authentication → Sign In / Providers → Email.
- Verified Authentication → Attack Protection displays **ENABLED** after save.
- Queried live security advisors: `auth_leaked_password_protection` is no longer present. The Postgres patch warning remains.
- No password, credential, plan, compute, CAPTCHA, or other authentication setting was changed. No app deployment is needed for this server setting.

## Database upgrade preflight

Dashboard offers stable `17.6.1.166` from current `17.4.1.069`. The dialog initially defaults to `17.6.1.164 PREVIEW`; explicitly choose the stable version when resuming.

The final dialog warned **all services offline for up to 1 hour**, and no downgrade to the old Postgres version. The user explicitly authorized starting now after this explanation. Selected stable `17.6.1.166` and confirmed the upgrade.

Preflight observations:

- Dashboard says eligible, no blocking warning shown. No read replicas.
- Latest physical backup: **2026-09-11 06:40:36 UTC**, with daily backups also listed for Sep 4–10. Database backups exclude Storage object bytes.
- SQL database size 64,244,883 bytes; dashboard reports 1.04 GB total disk used of 8 GB. Existing SMALL compute, GP3 disk; no capacity purchase required or made.
- Installed extensions: plpgsql 1.0, pg_stat_statements 1.11, pg_trgm 1.6, pgcrypto 1.3, supabase_vault 0.3.1, uuid-ossp 1.1, pg_cron 1.6, pg_net 0.14.0. None of the documented PG17-deprecated extensions present.
- No table columns using the checked unsupported regcollation/regconfig/regdictionary/regnamespace/regoper/regoperator/regproc/regprocedure types.
- Two active logical slots have Supabase Realtime names (wal2json / pgoutput); no other slots returned. Do not manually drop these managed active slots. If the platform reports a blocker when resuming, investigate its supported procedure first.
- Baseline: 80 public tables, 253 policies, 208 migration-history rows, one cron job. cron.job_run_details occupies 679,936 bytes.
- Current Auth 2.196.0, PostgREST 14.5, Postgres engine 17.4.

After upgrade: verify project healthy and actual version, schema/policy/migration/cron baselines, extension and security-advisor status, then hosted app reads, signed photo loading, auth UI and Realtime behavior. Signed-in end-to-end testing remains separate.

References: https://supabase.com/docs/guides/platform/upgrading and https://supabase.com/docs/guides/auth/password-security (read current versions this turn).

This local audit record is not intended for the public repository. A pre-existing modification to ios/App/App/AppDelegate.swift was observed and left untouched.

## Upgrade execution and verification

- Platform start: **2026-09-11 10:35:43 UTC**. Tracking ID `31df64ce-6650-4152-80ba-4f1be5ef494e`.
- Watched preparation, successful preflight, API shutdown, database migration, extension updates and optimization complete.
- Around 10:43 UTC, dashboard reported upgrade complete and project online, with a full backup running. This is approximately eight minutes from start to online, not a precise measured client outage.
- Management API subsequently confirmed **ACTIVE_HEALTHY**, version **17.6.1.166**, release channel **ga**. Live SQL confirms engine **17.6**, postmaster start 10:43:02 UTC; fresh query at 10:45:24 UTC succeeded.
- Baselines unchanged: 80 public tables, 253 policies, 208 migration rows, one cron job. pg_cron upgraded 1.6 → 1.6.4; pg_net 0.14.0 → 0.20.4; other inventoried extensions unchanged.
- Rate-limit helper remains inaccessible to anon/authenticated and accessible to service_role. Bucket visibility unchanged; the earlier photo privacy cutover remains pending.
- Security advisor no longer reports either vulnerable_postgres_version or leaked-password protection. Remaining findings: 14 RLS/no-policy, one public extension, 84 anon / 95 authenticated security-definer findings. These require the separately scoped audit; this upgrade does not close them.
- Local read-only `platform-smoke.mjs`: Auth health/settings HTTP 200, public community_ratings read HTTP 200, Realtime anonymous channel SUBSCRIBED then disconnected. No broadcast or database write. The first probe used the API's root schema endpoint and received 401; replaced that unsuitable app-read probe with the actual public ratings endpoint. No permissions were broadened.
- Fresh production browser loaded community posts, profiles, reel listing and guides. Opened a photo gallery and advanced 1 → 2 of 14. All 48 observed Supabase storage image sources used signed routes; 37 were loaded, zero broken, remaining images pending/lazy at observation. Sign-in dialog with Apple/Google/email/phone options opened. No returned error/warning console logs.
- Actual signed-in login, private chat events, purchases, native flows and signed-in writes were not exercised by these upgrade checks.
- Dashboard briefly showed a database-process-down health card after returning online, conflicting with ACTIVE_HEALTHY and successful fresh SQL/app reads; checking whether that restart-era alert clears. New physical backup row dated 10:46:14 UTC was initially marked BACKUP IN PROGRESS; completion still being monitored.
- Subsequent refreshed Backups page confirms the **10:46:14 UTC physical backup completed**, with Restore available and no in-progress label.
- Final fully loaded dashboard shows **Healthy** and no overview health issues. Both transient post-restart cards (database process down, then rolling Data API error rate) cleared. A repeat Auth/public-read/Realtime smoke check passed before this final refresh. The dashboard overview's no-issues message does not replace the detailed security-advisor findings listed above.
