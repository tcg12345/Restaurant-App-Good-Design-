-- Add home_city + lat/lng to user_profiles. The city label is what experts
-- (and any user) declare as their home base ("Westport, CT", "Brooklyn,
-- NY"); the coords let the city-explore page surface "experts in this
-- area" without re-geocoding every profile.
--
-- All three columns are nullable so existing profiles stay valid; the
-- expert profile-edit form is what nudges experts to fill them in.
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS home_city TEXT;
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS home_lat DOUBLE PRECISION;
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS home_lng DOUBLE PRECISION;

-- Index on coords so the "experts near {lat,lng}" query stays cheap as
-- the table grows. PostGIS would be tighter but a btree on lat is
-- sufficient for our scale and stays inside vanilla Postgres.
CREATE INDEX IF NOT EXISTS idx_user_profiles_home_lat ON public.user_profiles (home_lat);
