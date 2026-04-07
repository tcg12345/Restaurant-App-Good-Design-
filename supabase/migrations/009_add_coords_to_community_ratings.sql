-- Add latitude/longitude to community_ratings for map markers.
-- Run this in your Supabase SQL Editor.
ALTER TABLE public.community_ratings ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION;
ALTER TABLE public.community_ratings ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION;
ALTER TABLE public.community_ratings ADD COLUMN IF NOT EXISTS photo_url TEXT NOT NULL DEFAULT '';
