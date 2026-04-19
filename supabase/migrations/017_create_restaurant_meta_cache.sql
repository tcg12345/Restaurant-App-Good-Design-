-- Shared cache of restaurant metadata (coords + photo) keyed by the Google
-- Place ID. Everyone can read so one user's lookup benefits every viewer;
-- any authenticated user can upsert so the first viewer who lands on a
-- profile or detail page pays the Places API cost once and the result is
-- persisted for everyone else.
--
-- Why a shared, world-writable-by-authed table: the data is objective
-- place metadata (lat/lng, official photo). No per-user variance, so a
-- central cache deduplicates lookups across the whole app.

CREATE TABLE IF NOT EXISTS public.restaurant_meta_cache (
  restaurant_id TEXT PRIMARY KEY,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  photo_url TEXT,
  name TEXT,
  address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.restaurant_meta_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read restaurant meta cache" ON public.restaurant_meta_cache;
DROP POLICY IF EXISTS "Authenticated can insert restaurant meta cache" ON public.restaurant_meta_cache;
DROP POLICY IF EXISTS "Authenticated can update restaurant meta cache" ON public.restaurant_meta_cache;

CREATE POLICY "Anyone can read restaurant meta cache"
  ON public.restaurant_meta_cache FOR SELECT USING (true);
CREATE POLICY "Authenticated can insert restaurant meta cache"
  ON public.restaurant_meta_cache FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "Authenticated can update restaurant meta cache"
  ON public.restaurant_meta_cache FOR UPDATE USING (auth.role() = 'authenticated');
