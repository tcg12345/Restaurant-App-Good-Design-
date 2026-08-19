-- 066: repair rating activity timestamps. OPTIONAL, LOSSY, OFF BY DEFAULT.
-- Run this in your Supabase SQL Editor.
-- ════════════════════════════════════════════════════════════════════
-- `community_ratings.updated_at` is what the friends feed sorts on,
-- prints as "Rated · 2 minutes ago", and diffs against created_at to
-- stamp a row "edited". Until the client fix that ships alongside this
-- file, three writers advanced it with no user intent behind them:
--
--   • the map's background geocoder, patching coordinates onto old
--     ratings whenever the "My ratings" map was opened,
--   • the score settler, nudging neighbours by a tenth after an
--     unrelated new rating,
--   • the boot sync, whose "what changed" fingerprint lives in
--     localStorage — so a new device or a cleared cache re-uploaded
--     every rating the user had ever made.
--
-- Each of those republished months-old ratings into every friend's feed
-- stamped with the current minute. The client no longer does any of it,
-- but rows already written carry the wrong time, and nothing in the
-- database can tell a geocode bump apart from a genuine edit.
--
-- This resets updated_at to created_at, which is the one timestamp
-- nothing ever clobbered. Feeds then read as "rated when they actually
-- rated it". THE COST: a real re-visit or edit that happened after the
-- original rating loses its later stamp and reads as the original date.
-- That is wrong too — just far less wrong than "2 minutes ago" on a meal
-- from March.
--
-- ── Look before you leap ────────────────────────────────────────────
-- How many rows would move, and by how much:
--
--   SELECT count(*) AS rows_affected,
--          round(avg(EXTRACT(EPOCH FROM (updated_at - created_at)) / 86400)::numeric, 1) AS avg_days_moved,
--          round(max(EXTRACT(EPOCH FROM (updated_at - created_at)) / 86400)::numeric, 1) AS max_days_moved
--     FROM public.community_ratings
--    WHERE updated_at > created_at + interval '1 minute';
--
-- A spot check of your own worst offenders:
--
--   SELECT restaurant_name, created_at, updated_at
--     FROM public.community_ratings
--    WHERE user_id = auth.uid()
--    ORDER BY updated_at - created_at DESC
--    LIMIT 20;

DO $$
DECLARE
  -- ── Flip this to true, then run the file, to apply the repair. ──
  apply_repair BOOLEAN := false;
  v_rows BIGINT;
BEGIN
  SELECT count(*) INTO v_rows
    FROM public.community_ratings
   WHERE updated_at > created_at + interval '1 minute';

  IF NOT apply_repair THEN
    RAISE NOTICE 'Nothing changed. % rating(s) carry an updated_at later than their created_at.', v_rows;
    RAISE NOTICE 'Set apply_repair := true at the top of this block to reset them to created_at.';
    RETURN;
  END IF;

  UPDATE public.community_ratings
     SET updated_at = created_at
   WHERE updated_at > created_at + interval '1 minute';

  RAISE NOTICE 'Repaired % rating(s): updated_at reset to created_at.', v_rows;
END $$;
