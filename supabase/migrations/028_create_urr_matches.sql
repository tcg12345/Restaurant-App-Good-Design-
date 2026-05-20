-- URR pairwise match pool. Every row is one user's preference between two
-- restaurants (winner over loser). Used by urr_compute to derive filter-aware
-- ratings; aggregates surface via the urr_ratings_cache table.

CREATE TABLE IF NOT EXISTS public.urr_matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  winner_restaurant_id TEXT NOT NULL,
  loser_restaurant_id  TEXT NOT NULL,
  CHECK (winner_restaurant_id <> loser_restaurant_id),

  -- Strength of preference in [0, 1]. 0.5 = draw, 1.0 = total dominance.
  -- Backfill maps list-distance to a logistic curve; explicit UI sets it
  -- from "much better"/"slightly better" buttons; reorder uses the same
  -- tanh formula as backfill.
  margin NUMERIC(4,3) NOT NULL DEFAULT 0.5 CHECK (margin >= 0 AND margin <= 1),

  -- Snapshotted context. Filter slices read from here instead of joining
  -- against current restaurant metadata, so re-categorizing a restaurant
  -- later does not invalidate a slice.
  -- Shape: { winner: {cuisine, price, city, neighborhood, lat, lng},
  --          loser:  {cuisine, price, city, neighborhood, lat, lng} }
  context_tags JSONB NOT NULL DEFAULT '{}'::jsonb,

  source TEXT NOT NULL DEFAULT 'explicit'
    CHECK (source IN ('explicit', 'reorder', 'backfill', 'experimental')),
  source_ref TEXT,

  -- Phase-2 hooks; NULL/{} in MVP.
  rater_ambition NUMERIC(4,3),
  extras JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.urr_matches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own matches" ON public.urr_matches;
DROP POLICY IF EXISTS "Users can insert own matches" ON public.urr_matches;
DROP POLICY IF EXISTS "Users can delete own matches" ON public.urr_matches;

CREATE POLICY "Users can read own matches"
  ON public.urr_matches FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own matches"
  ON public.urr_matches FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own matches"
  ON public.urr_matches FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_urr_matches_winner ON public.urr_matches(winner_restaurant_id);
CREATE INDEX IF NOT EXISTS idx_urr_matches_loser  ON public.urr_matches(loser_restaurant_id);
CREATE INDEX IF NOT EXISTS idx_urr_matches_user   ON public.urr_matches(user_id);
CREATE INDEX IF NOT EXISTS idx_urr_matches_created ON public.urr_matches(created_at DESC);

-- Idempotent rerun for backfill and reorder. Explicit matches accumulate.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_urr_matches_source_ref
  ON public.urr_matches(user_id, source, source_ref)
  WHERE source_ref IS NOT NULL;
