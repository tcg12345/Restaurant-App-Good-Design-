-- 054: Shared restaurant geocode cache.
--
-- Profile and Discover maps geocode coordinate-less ratings client-side
-- (Google Places / Mapbox — paid calls) and used to "persist" the result
-- by re-publishing the rating row — with the RATING OWNER's user id. On
-- anyone else's profile/map RLS rejected every write silently, so the same
-- restaurants were re-geocoded on every mount, burning quota forever.
--
-- Coordinates are derived, non-sensitive data keyed by the public place id,
-- so any authenticated user may read and write the cache. last-writer-wins
-- is fine: all writers resolve the same physical place.

CREATE TABLE IF NOT EXISTS public.restaurant_geo (
  restaurant_id text PRIMARY KEY,
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.restaurant_geo ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can read geo cache" ON public.restaurant_geo;
CREATE POLICY "Authenticated can read geo cache"
  ON public.restaurant_geo FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Authenticated can insert geo cache" ON public.restaurant_geo;
CREATE POLICY "Authenticated can insert geo cache"
  ON public.restaurant_geo FOR INSERT
  TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated can update geo cache" ON public.restaurant_geo;
CREATE POLICY "Authenticated can update geo cache"
  ON public.restaurant_geo FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);
