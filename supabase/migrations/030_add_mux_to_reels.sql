-- 030: Mux adaptive streaming for reels (new uploads).
-- ════════════════════════════════════════════════════════════════════
-- New reels ingest to Mux: the client uploads straight to Mux via a
-- short-lived direct-upload URL, Mux transcodes to HLS asynchronously, and
-- the `mux-webhook` Edge Function (service role) writes the playback id back
-- here. Playback then uses Mux Player with a public playback id.
--
-- Existing Supabase-Storage reels are left completely untouched and keep
-- playing on the signed-URL path. A row is a "Mux reel" iff mux_playback_id
-- is set (ready) — or mux_status is non-null while it's still processing.

ALTER TABLE public.reels
  ADD COLUMN IF NOT EXISTS mux_upload_id   TEXT,
  ADD COLUMN IF NOT EXISTS mux_asset_id    TEXT,
  ADD COLUMN IF NOT EXISTS mux_playback_id TEXT,
  ADD COLUMN IF NOT EXISTS mux_status      TEXT;

-- Legacy reels constrain mux_status to the known states; NULL = a non-Mux
-- (Storage) reel. Done as a NOT VALID add so it can't fail on existing rows.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'reels_mux_status_check'
  ) THEN
    ALTER TABLE public.reels
      ADD CONSTRAINT reels_mux_status_check
      CHECK (mux_status IS NULL OR mux_status IN ('processing', 'ready', 'errored'));
  END IF;
END $$;

-- Mux reels have no Storage object, so the legacy path column is now optional.
ALTER TABLE public.reels ALTER COLUMN video_path DROP NOT NULL;

-- The webhook correlates events back to a row by passthrough (= the reel's
-- own id, the race-free primary path) and falls back to upload/asset id.
CREATE INDEX IF NOT EXISTS idx_reels_mux_upload ON public.reels(mux_upload_id);
CREATE INDEX IF NOT EXISTS idx_reels_mux_asset  ON public.reels(mux_asset_id);
