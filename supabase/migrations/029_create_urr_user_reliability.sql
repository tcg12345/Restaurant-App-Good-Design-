-- Per-user signal weights for the URR compute job. The MVP only fills
-- `experience` (min(match_count/50, 1.0)). Phase 2 will add a separate
-- `reliability NUMERIC(4,3)` column on this same table holding an EM-computed
-- agreement-with-consensus score; the two measure different things and may
-- both be useful, hence the table name stays `urr_user_reliability`.

CREATE TABLE IF NOT EXISTS public.urr_user_reliability (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,

  -- MVP heuristic: min(match_count / 50, 1.0). Caps at 1.0 after 50 matches.
  experience NUMERIC(4,3) NOT NULL DEFAULT 0 CHECK (experience BETWEEN 0 AND 1),
  match_count INTEGER NOT NULL DEFAULT 0,

  -- Phase 2: per-surface experience scalars per user, e.g. {"cuisine:italian": 0.71}.
  -- Empty in MVP; readers fall back to the scalar `experience`.
  surface_experience JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Phase 2: ambition profile, e.g. {"tough": 0.7, "fair": 0.2, "generous": 0.1}.
  ambition_profile JSONB NOT NULL DEFAULT '{}'::jsonb,

  computed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.urr_user_reliability ENABLE ROW LEVEL SECURITY;

-- World-readable so the UI can render "rated by N experienced raters" hints.
-- No INSERT/UPDATE/DELETE policies — writes are service-role only (compute job).
DROP POLICY IF EXISTS "Anyone can read urr reliability" ON public.urr_user_reliability;
CREATE POLICY "Anyone can read urr reliability"
  ON public.urr_user_reliability FOR SELECT USING (true);

CREATE INDEX IF NOT EXISTS idx_urr_user_reliability_computed
  ON public.urr_user_reliability(computed_at DESC);
