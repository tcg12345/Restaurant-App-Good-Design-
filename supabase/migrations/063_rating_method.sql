-- 063: Rating-method provenance on community ratings.
-- Run this in your Supabase SQL Editor.
--
-- Head-to-head is now the app's primary rating method. Scores the user
-- picked by hand on the slider are still shared as individual reviews,
-- but they must NOT contribute to a restaurant's community averages,
-- rater counts, or recommendation signals — self-picked numbers aren't
-- calibrated against anything and would corrupt the comparative data.
--
--   rating_method = 'h2h'    → head-to-head comparisons (contributes)
--   rating_method = 'import' → transcribed from a Beli/list import
--                              (contributes — it came from Beli's own
--                              head-to-head rankings)
--   rating_method = 'slider' → self-picked score (visible, NOT counted)
--   rating_method IS NULL    → rated before method tracking existed —
--                              grandfathered as contributing.
--
-- Readers that aggregate therefore filter with:
--   (rating_method IS NULL OR rating_method <> 'slider')

ALTER TABLE community_ratings
  ADD COLUMN IF NOT EXISTS rating_method TEXT;
