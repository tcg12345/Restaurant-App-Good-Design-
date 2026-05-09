-- 022: Posts — multi-media carousels with per-item attachments.
-- ════════════════════════════════════════════════════════════════════
-- A post is 1–15 photo/video items, each optionally tied to its own
-- restaurant or recipe attachment + caption. Engagement (likes / saves
-- / comments) lives in dedicated child tables that mirror the reels
-- model. Post media lives in a private `post-media` bucket; clients
-- mint signed URLs at read time, gated by post visibility.

-- ── Posts table ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  caption TEXT NOT NULL DEFAULT '',
  location_label TEXT NOT NULL DEFAULT '',
  audio_label TEXT NOT NULL DEFAULT 'Original audio',
  is_public BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_posts_user_created ON public.posts(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_created ON public.posts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_is_public ON public.posts(is_public, created_at DESC);

-- ── Per-item table ───────────────────────────────────────────────────
-- Position is 0-indexed and bounded to 15 items max (0..14).
CREATE TABLE IF NOT EXISTS public.post_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position >= 0 AND position < 15),
  media_type TEXT NOT NULL CHECK (media_type IN ('photo', 'video')),
  media_path TEXT NOT NULL,
  caption TEXT NOT NULL DEFAULT '',
  attached_kind TEXT CHECK (attached_kind IN ('restaurant', 'recipe')),
  restaurant_id TEXT,
  restaurant_data JSONB,
  recipe_id TEXT,
  recipe_data JSONB,
  duration_seconds NUMERIC,
  bg_gradient TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (post_id, position)
);

CREATE INDEX IF NOT EXISTS idx_post_items_post ON public.post_items(post_id, position);

ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.post_items ENABLE ROW LEVEL SECURITY;

-- Posts visibility: public OR owner OR accepted-follower (mirrors reels).
DROP POLICY IF EXISTS "Posts visible to public, owner, and followers" ON public.posts;
DROP POLICY IF EXISTS "Users can insert own posts" ON public.posts;
DROP POLICY IF EXISTS "Users can update own posts" ON public.posts;
DROP POLICY IF EXISTS "Users can delete own posts" ON public.posts;

CREATE POLICY "Posts visible to public, owner, and followers" ON public.posts
  FOR SELECT USING (
    is_public = true
    OR auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM public.user_friends uf
      WHERE uf.user_id = auth.uid()
        AND uf.friend_id = public.posts.user_id
        AND uf.status = 'accepted'
    )
  );
CREATE POLICY "Users can insert own posts" ON public.posts FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own posts" ON public.posts FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own posts" ON public.posts FOR DELETE USING (auth.uid() = user_id);

-- post_items inherit visibility from the parent post.
DROP POLICY IF EXISTS "Post items visible per parent post" ON public.post_items;
DROP POLICY IF EXISTS "Users can insert own post items" ON public.post_items;
DROP POLICY IF EXISTS "Users can update own post items" ON public.post_items;
DROP POLICY IF EXISTS "Users can delete own post items" ON public.post_items;

CREATE POLICY "Post items visible per parent post" ON public.post_items
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.posts p
      WHERE p.id = public.post_items.post_id
        AND (
          p.is_public = true
          OR auth.uid() = p.user_id
          OR EXISTS (
            SELECT 1 FROM public.user_friends uf
            WHERE uf.user_id = auth.uid()
              AND uf.friend_id = p.user_id
              AND uf.status = 'accepted'
          )
        )
    )
  );
CREATE POLICY "Users can insert own post items" ON public.post_items
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.posts p
      WHERE p.id = public.post_items.post_id AND p.user_id = auth.uid()
    )
  );
CREATE POLICY "Users can update own post items" ON public.post_items
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.posts p
      WHERE p.id = public.post_items.post_id AND p.user_id = auth.uid()
    )
  );
CREATE POLICY "Users can delete own post items" ON public.post_items
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.posts p
      WHERE p.id = public.post_items.post_id AND p.user_id = auth.uid()
    )
  );

-- ── Engagement: likes / saves / comments ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.post_likes (
  post_id UUID NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_post_likes_post ON public.post_likes(post_id);
CREATE INDEX IF NOT EXISTS idx_post_likes_user ON public.post_likes(user_id);
ALTER TABLE public.post_likes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read post likes" ON public.post_likes;
DROP POLICY IF EXISTS "Users can insert own post likes" ON public.post_likes;
DROP POLICY IF EXISTS "Users can delete own post likes" ON public.post_likes;
CREATE POLICY "Anyone can read post likes" ON public.post_likes FOR SELECT USING (true);
CREATE POLICY "Users can insert own post likes" ON public.post_likes FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own post likes" ON public.post_likes FOR DELETE USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.post_saves (
  post_id UUID NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_post_saves_post ON public.post_saves(post_id);
CREATE INDEX IF NOT EXISTS idx_post_saves_user ON public.post_saves(user_id);
ALTER TABLE public.post_saves ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read post saves" ON public.post_saves;
DROP POLICY IF EXISTS "Users can insert own post saves" ON public.post_saves;
DROP POLICY IF EXISTS "Users can delete own post saves" ON public.post_saves;
CREATE POLICY "Anyone can read post saves" ON public.post_saves FOR SELECT USING (true);
CREATE POLICY "Users can insert own post saves" ON public.post_saves FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own post saves" ON public.post_saves FOR DELETE USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.post_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_post_comments_post ON public.post_comments(post_id, created_at DESC);
ALTER TABLE public.post_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read post comments" ON public.post_comments;
DROP POLICY IF EXISTS "Users can insert own post comments" ON public.post_comments;
DROP POLICY IF EXISTS "Users can update own post comments" ON public.post_comments;
DROP POLICY IF EXISTS "Users can delete own post comments" ON public.post_comments;
CREATE POLICY "Anyone can read post comments" ON public.post_comments FOR SELECT USING (true);
CREATE POLICY "Users can insert own post comments" ON public.post_comments FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own post comments" ON public.post_comments FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own post comments" ON public.post_comments FOR DELETE USING (auth.uid() = user_id);

-- ── Storage bucket: post-media (private, signed URLs) ────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('post-media', 'post-media', false)
ON CONFLICT (id) DO UPDATE SET public = false;

DROP POLICY IF EXISTS "Post media visible per post visibility" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload their own post media" ON storage.objects;
DROP POLICY IF EXISTS "Users can update their own post media" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own post media" ON storage.objects;

CREATE POLICY "Post media visible per post visibility" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'post-media'
    AND EXISTS (
      SELECT 1
      FROM public.post_items pi
      JOIN public.posts p ON p.id = pi.post_id
      WHERE pi.media_path = storage.objects.name
        AND (
          p.is_public = true
          OR auth.uid() = p.user_id
          OR EXISTS (
            SELECT 1 FROM public.user_friends uf
            WHERE uf.user_id = auth.uid()
              AND uf.friend_id = p.user_id
              AND uf.status = 'accepted'
          )
        )
    )
  );

CREATE POLICY "Users can upload their own post media" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'post-media'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );
CREATE POLICY "Users can update their own post media" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'post-media'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );
CREATE POLICY "Users can delete their own post media" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'post-media'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );
