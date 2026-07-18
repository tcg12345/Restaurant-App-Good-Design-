-- ═══════════════════════════════════════════════════════
-- Track each Mux asset's playback policy on its row
-- Run this in your Supabase SQL Editor. Safe to run multiple times.
-- ═══════════════════════════════════════════════════════
--
-- Followers-only reels / post videos are created with Mux's SIGNED playback
-- policy (their stream/thumbnail URLs require a short-lived token minted by
-- the mux-playback-token Edge Function), while public ones keep the plain
-- public policy. The client needs to know which is which at render time, so
-- the policy is recorded here: set at upload by the client (from the
-- mux-upload-init response), and kept in sync by the mux-set-visibility
-- function when a reel/post flips public ↔ followers-only.
--
-- Existing rows default to 'public' — correct, since every asset created
-- before this migration used the public policy. Run
-- scripts/mux-backfill-signed-playback.mjs to convert existing
-- followers-only content to signed playback.

ALTER TABLE public.reels
  ADD COLUMN IF NOT EXISTS mux_playback_policy TEXT NOT NULL DEFAULT 'public';

ALTER TABLE public.post_items
  ADD COLUMN IF NOT EXISTS mux_playback_policy TEXT NOT NULL DEFAULT 'public';
