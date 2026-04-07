-- Expert recommendations table: curated picks from expert users for specific restaurants.
-- Anyone can read, only the expert who wrote it can insert/update/delete.
-- Run this in your Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS public.expert_recommendations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  restaurant_id TEXT NOT NULL,
  restaurant_name TEXT NOT NULL DEFAULT '',
  cuisine TEXT NOT NULL DEFAULT '',
  price TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  photo_url TEXT NOT NULL DEFAULT '',
  recommendation_text TEXT NOT NULL DEFAULT '',
  highlight_dishes TEXT[] NOT NULL DEFAULT '{}',
  rating NUMERIC NOT NULL CHECK (rating >= 0 AND rating <= 10),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, restaurant_id)
);

ALTER TABLE public.expert_recommendations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read expert recommendations" ON public.expert_recommendations;
DROP POLICY IF EXISTS "Experts can insert own recommendations" ON public.expert_recommendations;
DROP POLICY IF EXISTS "Experts can update own recommendations" ON public.expert_recommendations;
DROP POLICY IF EXISTS "Experts can delete own recommendations" ON public.expert_recommendations;

CREATE POLICY "Anyone can read expert recommendations" ON public.expert_recommendations FOR SELECT USING (true);
CREATE POLICY "Experts can insert own recommendations" ON public.expert_recommendations FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Experts can update own recommendations" ON public.expert_recommendations FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Experts can delete own recommendations" ON public.expert_recommendations FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_expert_recommendations_restaurant ON public.expert_recommendations(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_expert_recommendations_user ON public.expert_recommendations(user_id);
