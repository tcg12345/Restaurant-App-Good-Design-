-- Guides table: editorial-style curated lists of restaurants OR recipes
-- created by users. A guide has a cover photo, a title, an optional intro
-- paragraph, tags, and an ordered `entries` array. Each entry references
-- a restaurant or recipe id (depending on the guide's `type`) and stores
-- per-entry editorial copy (must-order, best-for, insider-tip).
--
-- One row per guide. RLS: owner can do anything with their own guides;
-- anyone can read guides where `is_published = true AND visibility = 'public'`.
-- Mirrors the pattern from 001_create_user_app_data.sql.

CREATE TABLE IF NOT EXISTS public.guides (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type          TEXT NOT NULL CHECK (type IN ('restaurants', 'recipes')),
  title         TEXT NOT NULL,
  subtitle      TEXT NOT NULL DEFAULT '',
  intro         TEXT NOT NULL DEFAULT '',
  cover_photo   TEXT NOT NULL DEFAULT '',
  tags          TEXT[] NOT NULL DEFAULT '{}',
  visibility    TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'public')),
  is_published  BOOLEAN NOT NULL DEFAULT false,
  entries       JSONB NOT NULL DEFAULT '[]'::jsonb,
  avg_score     NUMERIC,
  read_minutes  INT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_guides_user_id ON public.guides(user_id);
CREATE INDEX IF NOT EXISTS idx_guides_published_public
  ON public.guides(visibility, is_published, created_at DESC)
  WHERE is_published = true AND visibility = 'public';

ALTER TABLE public.guides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owners can read own guides" ON public.guides;
DROP POLICY IF EXISTS "Anyone can read public published guides" ON public.guides;
DROP POLICY IF EXISTS "Owners can insert own guides" ON public.guides;
DROP POLICY IF EXISTS "Owners can update own guides" ON public.guides;
DROP POLICY IF EXISTS "Owners can delete own guides" ON public.guides;

CREATE POLICY "Owners can read own guides"
  ON public.guides FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Anyone can read public published guides"
  ON public.guides FOR SELECT
  USING (is_published = true AND visibility = 'public');

CREATE POLICY "Owners can insert own guides"
  ON public.guides FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Owners can update own guides"
  ON public.guides FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Owners can delete own guides"
  ON public.guides FOR DELETE
  USING (auth.uid() = user_id);

-- saved_guides: track which guides each user has bookmarked. Separate
-- table (rather than JSONB on user_app_data) so we can index lookups by
-- guide_id for "who saved this" / save-count.
CREATE TABLE IF NOT EXISTS public.saved_guides (
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  guide_id   UUID NOT NULL REFERENCES public.guides(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, guide_id)
);

CREATE INDEX IF NOT EXISTS idx_saved_guides_user_id ON public.saved_guides(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_saved_guides_guide_id ON public.saved_guides(guide_id);

ALTER TABLE public.saved_guides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own saves" ON public.saved_guides;
DROP POLICY IF EXISTS "Users can insert own saves" ON public.saved_guides;
DROP POLICY IF EXISTS "Users can delete own saves" ON public.saved_guides;

CREATE POLICY "Users can read own saves"
  ON public.saved_guides FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own saves"
  ON public.saved_guides FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own saves"
  ON public.saved_guides FOR DELETE
  USING (auth.uid() = user_id);
