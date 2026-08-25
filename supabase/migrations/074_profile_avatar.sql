-- 074: Profile photos — an avatar_url on user_profiles.
-- ════════════════════════════════════════════════════════════════════
-- Until now every avatar in the app was a generated monogram: the first
-- letter of the display name over a hue hashed from the user id. That is
-- still the fallback (and still what you get before you upload anything),
-- but "Edit profile" can now set a real photograph.
--
-- The image itself is NOT stored here. It goes through the same pipeline
-- as every other user photo — compressed client-side by lib/images.ts and
-- uploaded to the public `photos` bucket under the uploader's own folder
-- (migration 039 owns that bucket and its RLS) — so this column holds only
-- the resulting public URL.
--
-- Idempotent; safe on an already-migrated database. Run it in the Supabase
-- SQL Editor.

-- ── The column ──────────────────────────────────────────────────────
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS avatar_url TEXT;

-- ── Reload PostgREST's schema cache ─────────────────────────────────
-- Without this the API keeps rejecting writes that name avatar_url until
-- PostgREST next restarts. (saveProfile treats avatar_url as an OPTIONAL
-- column, so a database that hasn't run this migration drops just that
-- field and still saves the rest of the profile — but the photo silently
-- won't stick until this runs.)
NOTIFY pgrst, 'reload schema';

-- ── Verify ──────────────────────────────────────────────────────────
--   SELECT column_name FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'user_profiles'
--      AND column_name = 'avatar_url';
