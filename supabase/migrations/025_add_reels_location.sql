-- 025: Reels — optional free-text location label.
-- ════════════════════════════════════════════════════════════════════
-- Mirrors the same column that `posts` already exposes (migration 022)
-- so reels can carry the place the video was shot at independently of
-- the featured restaurant attachment. Empty string when not provided.

ALTER TABLE public.reels
  ADD COLUMN IF NOT EXISTS location_label TEXT NOT NULL DEFAULT '';
