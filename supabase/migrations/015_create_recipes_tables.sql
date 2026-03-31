-- ═══════════════════════════════════════════════════════
-- 015: Create recipes and recipe_reviews tables
-- ═══════════════════════════════════════════════════════

-- ── Recipes table ──
CREATE TABLE IF NOT EXISTS public.recipes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  ingredients JSONB NOT NULL DEFAULT '[]'::jsonb,
  steps JSONB NOT NULL DEFAULT '[]'::jsonb,
  prep_time_minutes INTEGER,
  cook_time_minutes INTEGER,
  servings INTEGER,
  difficulty TEXT NOT NULL DEFAULT 'medium',
  cuisine TEXT NOT NULL DEFAULT '',
  tags TEXT[] NOT NULL DEFAULT '{}',
  photos TEXT[] NOT NULL DEFAULT '{}',
  is_public BOOLEAN NOT NULL DEFAULT false,
  source_type TEXT NOT NULL DEFAULT 'user',
  linked_restaurant_id TEXT,
  linked_meal_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.recipes ENABLE ROW LEVEL SECURITY;

-- Anyone can read public recipes; users can read their own private ones
DROP POLICY IF EXISTS "Users can read own recipes" ON public.recipes;
CREATE POLICY "Users can read own recipes" ON public.recipes
  FOR SELECT USING (auth.uid() = user_id OR is_public = true);

DROP POLICY IF EXISTS "Users can insert own recipes" ON public.recipes;
CREATE POLICY "Users can insert own recipes" ON public.recipes
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own recipes" ON public.recipes;
CREATE POLICY "Users can update own recipes" ON public.recipes
  FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own recipes" ON public.recipes;
CREATE POLICY "Users can delete own recipes" ON public.recipes
  FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_recipes_user ON public.recipes(user_id);
CREATE INDEX IF NOT EXISTS idx_recipes_public ON public.recipes(is_public) WHERE is_public = true;
CREATE INDEX IF NOT EXISTS idx_recipes_source ON public.recipes(source_type);
CREATE INDEX IF NOT EXISTS idx_recipes_user_updated ON public.recipes(user_id, updated_at DESC);

-- ── Recipe reviews table ──
CREATE TABLE IF NOT EXISTS public.recipe_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recipe_id UUID NOT NULL REFERENCES public.recipes(id) ON DELETE CASCADE,
  rating NUMERIC NOT NULL CHECK (rating >= 0 AND rating <= 10),
  notes TEXT NOT NULL DEFAULT '',
  photo TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, recipe_id)
);

ALTER TABLE public.recipe_reviews ENABLE ROW LEVEL SECURITY;

-- Anyone can read reviews
DROP POLICY IF EXISTS "Anyone can read recipe reviews" ON public.recipe_reviews;
CREATE POLICY "Anyone can read recipe reviews" ON public.recipe_reviews
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Users can insert own reviews" ON public.recipe_reviews;
CREATE POLICY "Users can insert own reviews" ON public.recipe_reviews
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own reviews" ON public.recipe_reviews;
CREATE POLICY "Users can update own reviews" ON public.recipe_reviews
  FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own reviews" ON public.recipe_reviews;
CREATE POLICY "Users can delete own reviews" ON public.recipe_reviews
  FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_recipe_reviews_recipe ON public.recipe_reviews(recipe_id);
CREATE INDEX IF NOT EXISTS idx_recipe_reviews_user ON public.recipe_reviews(user_id);
