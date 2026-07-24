-- 062: Recipe likes + comments (+ per-comment likes).
--
-- src/lib/supabase-recipes.ts has queried recipe_likes / recipe_comments /
-- recipe_comment_likes since the recipe social features shipped, but no
-- numbered migration ever created them — live databases got them by hand,
-- and a deployment built from this directory alone would silently lose
-- recipe likes and comments (the client degrades to no-ops when the tables
-- are missing). IF NOT EXISTS throughout: a no-op on databases that already
-- carry the hand-made tables.
--
-- target_id is TEXT, not a foreign key: it holds client-generated recipe /
-- home-meal ids, which live inside user_app_data's JSONB blobs rather than
-- in a table of their own.

CREATE TABLE IF NOT EXISTS public.recipe_likes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  target_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, target_id)
);

CREATE TABLE IF NOT EXISTS public.recipe_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  target_id TEXT NOT NULL,
  text TEXT NOT NULL,
  -- Nullable; null = top-level comment. The client also deletes replies
  -- explicitly before their parent, so pre-existing hand-made tables
  -- without this cascade behave identically.
  parent_id UUID REFERENCES public.recipe_comments(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.recipe_comment_likes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  comment_id UUID NOT NULL REFERENCES public.recipe_comments(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, comment_id)
);

ALTER TABLE public.recipe_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recipe_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recipe_comment_likes ENABLE ROW LEVEL SECURITY;

-- Same visibility model as activity/reel/post social rows: anyone can read
-- (the feed shows like counts and comments from all users), writers may
-- only create and delete their own rows.
DROP POLICY IF EXISTS "Anyone can read recipe likes" ON public.recipe_likes;
DROP POLICY IF EXISTS "Users can insert own recipe likes" ON public.recipe_likes;
DROP POLICY IF EXISTS "Users can delete own recipe likes" ON public.recipe_likes;
CREATE POLICY "Anyone can read recipe likes" ON public.recipe_likes
  FOR SELECT USING (true);
CREATE POLICY "Users can insert own recipe likes" ON public.recipe_likes
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own recipe likes" ON public.recipe_likes
  FOR DELETE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Anyone can read recipe comments" ON public.recipe_comments;
DROP POLICY IF EXISTS "Users can insert own recipe comments" ON public.recipe_comments;
DROP POLICY IF EXISTS "Users can delete own recipe comments" ON public.recipe_comments;
CREATE POLICY "Anyone can read recipe comments" ON public.recipe_comments
  FOR SELECT USING (true);
CREATE POLICY "Users can insert own recipe comments" ON public.recipe_comments
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own recipe comments" ON public.recipe_comments
  FOR DELETE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Anyone can read recipe comment likes" ON public.recipe_comment_likes;
DROP POLICY IF EXISTS "Users can insert own recipe comment likes" ON public.recipe_comment_likes;
DROP POLICY IF EXISTS "Users can delete own recipe comment likes" ON public.recipe_comment_likes;
CREATE POLICY "Anyone can read recipe comment likes" ON public.recipe_comment_likes
  FOR SELECT USING (true);
CREATE POLICY "Users can insert own recipe comment likes" ON public.recipe_comment_likes
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own recipe comment likes" ON public.recipe_comment_likes
  FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_recipe_likes_target ON public.recipe_likes(target_id);
CREATE INDEX IF NOT EXISTS idx_recipe_comments_target ON public.recipe_comments(target_id);
CREATE INDEX IF NOT EXISTS idx_recipe_comments_parent ON public.recipe_comments(parent_id);
CREATE INDEX IF NOT EXISTS idx_recipe_comment_likes_comment ON public.recipe_comment_likes(comment_id);
