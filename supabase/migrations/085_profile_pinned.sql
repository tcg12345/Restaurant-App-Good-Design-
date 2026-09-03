-- 085: Pinned items — up to three things a person puts at the top of their profile.
-- ════════════════════════════════════════════════════════════════════
-- A pin is a reference, not a copy: { "type": "restaurant" | "recipe" |
-- "meal" | "guide" | "post" | "reel", "id": "<that thing's id>" }. The
-- profile pages resolve each reference against data the viewer can already
-- read (their own ratings/recipes locally; a public profile's items through
-- the same RLS-guarded reads the profile tabs use), so a pin to something
-- the viewer isn't allowed to see simply doesn't render. Nothing new
-- becomes visible because it was pinned.
--
-- Stored on user_profiles because that row is what a public profile is
-- built from (world-readable, owner-writable — migration 003). The owner
-- writes it through saveProfile like bio or avatar_url; the guard trigger
-- from 034/035 doesn't touch it.
--
-- Idempotent; safe on an already-migrated database. Run it in the Supabase
-- SQL Editor.

-- ── The column ──────────────────────────────────────────────────────
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS pinned JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Three at most, always an array. The shape of each element is the
-- client's to keep; the database only guarantees the cap.
ALTER TABLE public.user_profiles DROP CONSTRAINT IF EXISTS user_profiles_pinned_shape;
ALTER TABLE public.user_profiles
  ADD CONSTRAINT user_profiles_pinned_shape
  CHECK (jsonb_typeof(pinned) = 'array' AND jsonb_array_length(pinned) <= 3);

-- ── Reload PostgREST's schema cache ─────────────────────────────────
-- saveProfile treats pinned as an OPTIONAL column: a database that hasn't
-- run this yet drops just that field and still saves the rest of the
-- profile, so pins silently don't stick until this runs.
NOTIFY pgrst, 'reload schema';

-- ── Verify ──────────────────────────────────────────────────────────
--   SELECT column_name FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'user_profiles'
--      AND column_name = 'pinned';
