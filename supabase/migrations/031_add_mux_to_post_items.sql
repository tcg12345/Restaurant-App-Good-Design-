-- 031: Mux adaptive streaming for post video items (Phase 2).
-- ════════════════════════════════════════════════════════════════════
-- Mirrors migration 030 (reels) for posts. A post is a 1–15 item carousel of
-- photos and/or videos; only the VIDEO items move to Mux. Photos stay in the
-- private `post-media` bucket (served as resized WebP via image transforms).
--
-- A video item is a "Mux item" iff mux_playback_id is set (ready) — or
-- mux_status is non-null while it's still processing. Existing Storage-backed
-- video items are untouched and keep playing on the signed-URL path.

ALTER TABLE public.post_items
  ADD COLUMN IF NOT EXISTS mux_upload_id   TEXT,
  ADD COLUMN IF NOT EXISTS mux_asset_id    TEXT,
  ADD COLUMN IF NOT EXISTS mux_playback_id TEXT,
  ADD COLUMN IF NOT EXISTS mux_status      TEXT;

-- NULL mux_status = a non-Mux (Storage) item or a photo. Added NOT VALID-style
-- via a guard so it can't fail on existing rows.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'post_items_mux_status_check'
  ) THEN
    ALTER TABLE public.post_items
      ADD CONSTRAINT post_items_mux_status_check
      CHECK (mux_status IS NULL OR mux_status IN ('processing', 'ready', 'errored'));
  END IF;
END $$;

-- Mux video items have no Storage object, so media_path is now optional.
ALTER TABLE public.post_items ALTER COLUMN media_path DROP NOT NULL;

-- The webhook correlates events back to a row by passthrough (= the item's own
-- id, the race-free primary path) and falls back to upload/asset id.
CREATE INDEX IF NOT EXISTS idx_post_items_mux_upload ON public.post_items(mux_upload_id);
CREATE INDEX IF NOT EXISTS idx_post_items_mux_asset  ON public.post_items(mux_asset_id);
