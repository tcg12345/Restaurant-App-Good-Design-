-- Pre-computed URR ratings per filter slice. World-readable cache populated
-- by the urr_compute Edge Function. One row per (filter_key, algo_version).
-- Modeled on home_rec_cache (migration 016) but global (not user-scoped).

CREATE TABLE IF NOT EXISTS public.urr_ratings_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Canonical slice key. "overall" or a sorted, lowercase, pipe-joined
  -- composition: "cuisine:italian|city:new-york|price:$$".
  filter_key TEXT NOT NULL,

  -- Per-restaurant ratings inside this slice.
  -- ratings_data shape per restaurantId:
  --   { score, rating, mu, sigma, ci_low, ci_high, n_matches, n_raters, experienced_n }
  --   - score:         user-facing 0-10 (per-slice logistic rescale of `rating`)
  --   - rating:        internal Elo, centered at 1500
  --   - mu:            mirrors `rating` in MVP; populated by Phase 2 TrueSkill
  --   - sigma:         NULL in MVP; Phase 2 TrueSkill standard deviation
  --   - ci_low/high:   heuristic 95% CI on `score` in MVP
  --   - n_matches:     total matches involving this restaurant in this slice
  --   - n_raters:      distinct raters
  --   - experienced_n: distinct raters with experience >= 0.5 (MVP)
  --     Phase 2 adds a parallel `reliable_n` key when EM reliability ships.
  ratings_data JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Slice metadata for fast UI display without re-aggregating ratings_data:
  --   { n_restaurants, n_matches, top_restaurant_ids: [...], updated_at_iso }
  slice_meta JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Algorithm version. Increment when compute logic changes so the frontend
  -- can pin to a known version and old slices can coexist with new.
  algo_version TEXT NOT NULL DEFAULT 'elo-v1',

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(filter_key, algo_version)
);

ALTER TABLE public.urr_ratings_cache ENABLE ROW LEVEL SECURITY;

-- World-readable; writes restricted to the service role used by the
-- compute Edge Function. No INSERT/UPDATE/DELETE policies are defined
-- intentionally, which means PostgREST blocks anon/authenticated writes.
DROP POLICY IF EXISTS "Anyone can read urr cache" ON public.urr_ratings_cache;
CREATE POLICY "Anyone can read urr cache"
  ON public.urr_ratings_cache FOR SELECT USING (true);

CREATE INDEX IF NOT EXISTS idx_urr_cache_filter_key ON public.urr_ratings_cache(filter_key);
CREATE INDEX IF NOT EXISTS idx_urr_cache_updated   ON public.urr_ratings_cache(updated_at DESC);
