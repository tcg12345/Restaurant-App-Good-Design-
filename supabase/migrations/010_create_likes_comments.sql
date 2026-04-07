-- Likes and comments for community ratings activity feed.
-- Run this in your Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS public.activity_likes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rating_id UUID NOT NULL REFERENCES public.community_ratings(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, rating_id)
);

CREATE TABLE IF NOT EXISTS public.activity_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rating_id UUID NOT NULL REFERENCES public.community_ratings(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.activity_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read likes" ON public.activity_likes;
DROP POLICY IF EXISTS "Users can insert own likes" ON public.activity_likes;
DROP POLICY IF EXISTS "Users can delete own likes" ON public.activity_likes;
CREATE POLICY "Anyone can read likes" ON public.activity_likes FOR SELECT USING (true);
CREATE POLICY "Users can insert own likes" ON public.activity_likes FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own likes" ON public.activity_likes FOR DELETE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Anyone can read comments" ON public.activity_comments;
DROP POLICY IF EXISTS "Users can insert own comments" ON public.activity_comments;
DROP POLICY IF EXISTS "Users can delete own comments" ON public.activity_comments;
CREATE POLICY "Anyone can read comments" ON public.activity_comments FOR SELECT USING (true);
CREATE POLICY "Users can insert own comments" ON public.activity_comments FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own comments" ON public.activity_comments FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_activity_likes_rating ON public.activity_likes(rating_id);
CREATE INDEX IF NOT EXISTS idx_activity_comments_rating ON public.activity_comments(rating_id);
