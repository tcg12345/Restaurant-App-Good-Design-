-- Per-user cache of home-page recommendations, keyed by a rounded location
-- key so nearby picks share a cache slot and we don't re-spend Google Places
-- API budget every time a user revisits the same city.
--
-- The frontend reads this before falling back to Google; if a recent entry
-- exists and the user's preferences hash hasn't drifted, we use the cached
-- places directly. Preference drift triggers a small top-up call rather than
-- a full refetch.

CREATE TABLE IF NOT EXISTS public.home_rec_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  location_key TEXT NOT NULL,               -- rounded "lat_lng" (~1 km slot)
  location_label TEXT NOT NULL DEFAULT '',
  location_lat DOUBLE PRECISION NOT NULL,
  location_lng DOUBLE PRECISION NOT NULL,
  preferences_hash TEXT NOT NULL DEFAULT '',
  places_data JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, location_key)
);

ALTER TABLE public.home_rec_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own home recs cache" ON public.home_rec_cache;
DROP POLICY IF EXISTS "Users can insert own home recs cache" ON public.home_rec_cache;
DROP POLICY IF EXISTS "Users can update own home recs cache" ON public.home_rec_cache;
DROP POLICY IF EXISTS "Users can delete own home recs cache" ON public.home_rec_cache;

CREATE POLICY "Users can read own home recs cache"
  ON public.home_rec_cache FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own home recs cache"
  ON public.home_rec_cache FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own home recs cache"
  ON public.home_rec_cache FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own home recs cache"
  ON public.home_rec_cache FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_home_rec_cache_user_loc
  ON public.home_rec_cache(user_id, location_key);
