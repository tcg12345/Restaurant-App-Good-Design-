-- Hotel dining options: maps a hotel to its on-site or nearby dining venues.
-- Anyone can read, authenticated users can insert/delete their own entries.
-- Run this in your Supabase SQL Editor.

CREATE TYPE public.dining_type AS ENUM (
  'breakfast',
  'restaurant',
  'bar',
  'room_service',
  'pool_bar',
  'rooftop'
);

CREATE TABLE IF NOT EXISTS public.hotel_dining (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_place_id TEXT NOT NULL,
  hotel_name TEXT NOT NULL DEFAULT '',
  hotel_address TEXT NOT NULL DEFAULT '',
  restaurant_place_id TEXT NOT NULL,
  restaurant_name TEXT NOT NULL DEFAULT '',
  dining_type public.dining_type NOT NULL DEFAULT 'restaurant',
  added_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(hotel_place_id, restaurant_place_id)
);

ALTER TABLE public.hotel_dining ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read hotel dining" ON public.hotel_dining;
DROP POLICY IF EXISTS "Authenticated users can insert hotel dining" ON public.hotel_dining;
DROP POLICY IF EXISTS "Users can delete own hotel dining entries" ON public.hotel_dining;

CREATE POLICY "Anyone can read hotel dining" ON public.hotel_dining FOR SELECT USING (true);
CREATE POLICY "Authenticated users can insert hotel dining" ON public.hotel_dining FOR INSERT WITH CHECK (auth.uid() = added_by);
CREATE POLICY "Users can delete own hotel dining entries" ON public.hotel_dining FOR DELETE USING (auth.uid() = added_by);

CREATE INDEX IF NOT EXISTS idx_hotel_dining_hotel ON public.hotel_dining(hotel_place_id);
CREATE INDEX IF NOT EXISTS idx_hotel_dining_restaurant ON public.hotel_dining(restaurant_place_id);
CREATE INDEX IF NOT EXISTS idx_hotel_dining_type ON public.hotel_dining(dining_type);
