-- 019: Reels — short-form videos with attached restaurant or recipe.
-- ════════════════════════════════════════════════════════════════════
-- All reels are publicly readable. Like / save / comment counts live in
-- their own tables so we can persist per-user state. Video bytes live in
-- the `reels-videos` storage bucket (path = <user_id>/<filename>).

-- ── Reels table ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.reels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('restaurant', 'recipe')),

  -- Storage path inside the `reels-videos` bucket so we can delete the
  -- object when the reel row is deleted.
  video_path TEXT NOT NULL,
  video_url TEXT NOT NULL,

  caption TEXT NOT NULL DEFAULT '',
  audio_label TEXT NOT NULL DEFAULT 'Original audio',
  bg_gradient TEXT NOT NULL DEFAULT '',
  duration_seconds NUMERIC,

  -- Denormalized snapshot of the attached restaurant or recipe so the
  -- card can render without joining other tables (and so the reel
  -- survives if the source is later removed).
  restaurant_id TEXT,
  restaurant_data JSONB,
  recipe_id TEXT,
  recipe_data JSONB,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT reels_attachment_present CHECK (
    (kind = 'restaurant' AND restaurant_data IS NOT NULL)
    OR (kind = 'recipe' AND recipe_data IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_reels_kind_created ON public.reels(kind, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reels_user ON public.reels(user_id, created_at DESC);

ALTER TABLE public.reels ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read reels" ON public.reels;
DROP POLICY IF EXISTS "Users can insert own reels" ON public.reels;
DROP POLICY IF EXISTS "Users can update own reels" ON public.reels;
DROP POLICY IF EXISTS "Users can delete own reels" ON public.reels;

CREATE POLICY "Anyone can read reels" ON public.reels FOR SELECT USING (true);
CREATE POLICY "Users can insert own reels" ON public.reels FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own reels" ON public.reels FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own reels" ON public.reels FOR DELETE USING (auth.uid() = user_id);

-- ── reel_likes ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.reel_likes (
  reel_id UUID NOT NULL REFERENCES public.reels(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (reel_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_reel_likes_reel ON public.reel_likes(reel_id);
CREATE INDEX IF NOT EXISTS idx_reel_likes_user ON public.reel_likes(user_id);

ALTER TABLE public.reel_likes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read reel likes" ON public.reel_likes;
DROP POLICY IF EXISTS "Users can insert own reel likes" ON public.reel_likes;
DROP POLICY IF EXISTS "Users can delete own reel likes" ON public.reel_likes;
CREATE POLICY "Anyone can read reel likes" ON public.reel_likes FOR SELECT USING (true);
CREATE POLICY "Users can insert own reel likes" ON public.reel_likes FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own reel likes" ON public.reel_likes FOR DELETE USING (auth.uid() = user_id);

-- ── reel_saves ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.reel_saves (
  reel_id UUID NOT NULL REFERENCES public.reels(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (reel_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_reel_saves_reel ON public.reel_saves(reel_id);
CREATE INDEX IF NOT EXISTS idx_reel_saves_user ON public.reel_saves(user_id);

ALTER TABLE public.reel_saves ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read reel saves" ON public.reel_saves;
DROP POLICY IF EXISTS "Users can insert own reel saves" ON public.reel_saves;
DROP POLICY IF EXISTS "Users can delete own reel saves" ON public.reel_saves;
CREATE POLICY "Anyone can read reel saves" ON public.reel_saves FOR SELECT USING (true);
CREATE POLICY "Users can insert own reel saves" ON public.reel_saves FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own reel saves" ON public.reel_saves FOR DELETE USING (auth.uid() = user_id);

-- ── reel_comments ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.reel_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reel_id UUID NOT NULL REFERENCES public.reels(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reel_comments_reel ON public.reel_comments(reel_id, created_at DESC);

ALTER TABLE public.reel_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read reel comments" ON public.reel_comments;
DROP POLICY IF EXISTS "Users can insert own reel comments" ON public.reel_comments;
DROP POLICY IF EXISTS "Users can update own reel comments" ON public.reel_comments;
DROP POLICY IF EXISTS "Users can delete own reel comments" ON public.reel_comments;
CREATE POLICY "Anyone can read reel comments" ON public.reel_comments FOR SELECT USING (true);
CREATE POLICY "Users can insert own reel comments" ON public.reel_comments FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own reel comments" ON public.reel_comments FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own reel comments" ON public.reel_comments FOR DELETE USING (auth.uid() = user_id);

-- ── Storage bucket for reel videos ───────────────────────────────────
-- Public read, scoped per-user write so a user can only put files under
-- a folder named with their auth uid.
INSERT INTO storage.buckets (id, name, public)
VALUES ('reels-videos', 'reels-videos', true)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;

DROP POLICY IF EXISTS "Reels videos are publicly readable" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload their own reel videos" ON storage.objects;
DROP POLICY IF EXISTS "Users can update their own reel videos" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own reel videos" ON storage.objects;

CREATE POLICY "Reels videos are publicly readable" ON storage.objects
  FOR SELECT USING (bucket_id = 'reels-videos');

CREATE POLICY "Users can upload their own reel videos" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'reels-videos'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Users can update their own reel videos" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'reels-videos'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Users can delete their own reel videos" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'reels-videos'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );
