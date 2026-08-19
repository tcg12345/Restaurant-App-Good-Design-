-- 065: Repair the optional user_profiles columns — fixes signup dead-ending
-- on "Could not find the 'home_city' column of 'user_profiles' in the
-- schema cache".
-- ════════════════════════════════════════════════════════════════════
-- Symptom: a new user who typed a home city in the profile-setup wizard got
-- that error on "Finish setup" and NO profile row was written, so the
-- account was never usable. Skipping the city step worked — the tell that
-- only the home_* payload keys were being rejected.
--
-- PostgREST validates a write against its schema cache and rejects the
-- WHOLE row (PGRST204) when it sees a column it doesn't know, so one
-- optional field took the entire account with it. Two situations produce
-- that error, and this migration covers both:
--
--   1. Migration 018 (home_city / home_lat / home_lng) never ran against
--      this database — the columns really are missing.
--   2. The columns exist, but PostgREST's cached schema predates them, so
--      it rejects the write before Postgres ever sees it.
--
-- Every statement is idempotent — safe to run on a database that is already
-- fully migrated. Run it in the Supabase SQL Editor.
--
-- The client no longer depends on this either: saveProfile
-- (src/lib/supabase-community.ts) now drops an unknown OPTIONAL column and
-- retries, so a database that is behind the app can never again block
-- account creation — it just stores less.

-- ── 1. The home-base columns from migration 018 ─────────────────────
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS home_city TEXT;
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS home_lat DOUBLE PRECISION;
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS home_lng DOUBLE PRECISION;
CREATE INDEX IF NOT EXISTS idx_user_profiles_home_lat ON public.user_profiles (home_lat);

-- ── 2. The other optional columns the profile save path writes ──────
-- Same failure mode, same one-line repair: bio (005) and is_public (006)
-- go up in the same upsert, and taste_profile (059) is written by the
-- onboarding palette test.
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS bio TEXT NOT NULL DEFAULT '';
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS taste_profile JSONB;

-- ── 3. Reload PostgREST's schema cache ──────────────────────────────
-- Covers situation 2 above, and makes the columns added by step 1 visible
-- to the API immediately instead of on PostgREST's next restart.
NOTIFY pgrst, 'reload schema';

-- ── Verify ──────────────────────────────────────────────────────────
-- Expect all six rows back:
--   SELECT column_name FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'user_profiles'
--      AND column_name IN ('home_city','home_lat','home_lng',
--                          'bio','is_public','taste_profile');
