-- Community ratings table: stores every user's rating for a restaurant
-- This is SHARED data (not per-user JSONB) so all users can see aggregated stats.
-- Run this in your Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS public.community_ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  restaurant_id TEXT NOT NULL,
  restaurant_name TEXT NOT NULL DEFAULT '',
  score NUMERIC NOT NULL CHECK (score >= 0 AND score <= 10),
  notes TEXT NOT NULL DEFAULT '',
  cuisine TEXT NOT NULL DEFAULT '',
  price TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  visit_date TEXT NOT NULL DEFAULT '',
  tags TEXT[] NOT NULL DEFAULT '{}',
  would_return BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, restaurant_id)
);

-- Community photos table: stores user-uploaded photos for restaurants
CREATE TABLE IF NOT EXISTS public.community_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  restaurant_id TEXT NOT NULL,
  url TEXT NOT NULL,
  caption TEXT NOT NULL DEFAULT '',
  is_favorite BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Friends table: who follows whom
CREATE TABLE IF NOT EXISTS public.user_friends (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  friend_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, friend_id)
);

-- Enable RLS
ALTER TABLE public.community_ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_friends ENABLE ROW LEVEL SECURITY;

-- Community ratings: anyone can read, users can write their own
DROP POLICY IF EXISTS "Anyone can read community ratings" ON public.community_ratings;
DROP POLICY IF EXISTS "Users can insert own ratings" ON public.community_ratings;
DROP POLICY IF EXISTS "Users can update own ratings" ON public.community_ratings;
DROP POLICY IF EXISTS "Users can delete own ratings" ON public.community_ratings;

CREATE POLICY "Anyone can read community ratings" ON public.community_ratings FOR SELECT USING (true);
CREATE POLICY "Users can insert own ratings" ON public.community_ratings FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own ratings" ON public.community_ratings FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own ratings" ON public.community_ratings FOR DELETE USING (auth.uid() = user_id);

-- Community photos: anyone can read, users can write their own
DROP POLICY IF EXISTS "Anyone can read community photos" ON public.community_photos;
DROP POLICY IF EXISTS "Users can insert own photos" ON public.community_photos;
DROP POLICY IF EXISTS "Users can delete own photos" ON public.community_photos;

CREATE POLICY "Anyone can read community photos" ON public.community_photos FOR SELECT USING (true);
CREATE POLICY "Users can insert own photos" ON public.community_photos FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own photos" ON public.community_photos FOR DELETE USING (auth.uid() = user_id);

-- Friends: users can read their own friend list, write their own
DROP POLICY IF EXISTS "Users can read own friends" ON public.user_friends;
DROP POLICY IF EXISTS "Users can insert own friends" ON public.user_friends;
DROP POLICY IF EXISTS "Users can delete own friends" ON public.user_friends;

CREATE POLICY "Users can read own friends" ON public.user_friends FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own friends" ON public.user_friends FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own friends" ON public.user_friends FOR DELETE USING (auth.uid() = user_id);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_community_ratings_restaurant ON public.community_ratings(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_community_ratings_user ON public.community_ratings(user_id);
CREATE INDEX IF NOT EXISTS idx_community_photos_restaurant ON public.community_photos(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_user_friends_user ON public.user_friends(user_id);
CREATE INDEX IF NOT EXISTS idx_user_friends_friend ON public.user_friends(friend_id);
