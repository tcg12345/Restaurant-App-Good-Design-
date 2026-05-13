-- Threaded replies + per-comment likes for the activity feed.
-- Run in your Supabase SQL Editor.

-- 1) Add a self-referential parent_id so a comment can be a reply to
--    another comment. Nullable; null = top-level comment.
ALTER TABLE public.activity_comments
  ADD COLUMN IF NOT EXISTS parent_id UUID
  REFERENCES public.activity_comments(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_activity_comments_parent
  ON public.activity_comments(parent_id);

-- 2) Per-comment likes — separate table so we can paginate / aggregate
--    independently of rating likes.
CREATE TABLE IF NOT EXISTS public.activity_comment_likes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  comment_id UUID NOT NULL REFERENCES public.activity_comments(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, comment_id)
);

ALTER TABLE public.activity_comment_likes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read comment likes" ON public.activity_comment_likes;
DROP POLICY IF EXISTS "Users can insert own comment likes" ON public.activity_comment_likes;
DROP POLICY IF EXISTS "Users can delete own comment likes" ON public.activity_comment_likes;
CREATE POLICY "Anyone can read comment likes" ON public.activity_comment_likes
  FOR SELECT USING (true);
CREATE POLICY "Users can insert own comment likes" ON public.activity_comment_likes
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own comment likes" ON public.activity_comment_likes
  FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_activity_comment_likes_comment
  ON public.activity_comment_likes(comment_id);
