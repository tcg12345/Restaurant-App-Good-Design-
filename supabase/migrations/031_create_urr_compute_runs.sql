-- Observability log for urr_compute runs. The frontend reads the latest
-- success row to render "URR updated N hours ago" next to the URR pill.

CREATE TABLE IF NOT EXISTS public.urr_compute_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  algo_version TEXT NOT NULL DEFAULT 'elo-v1',
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  match_count_processed INTEGER NOT NULL DEFAULT 0,
  restaurant_count INTEGER NOT NULL DEFAULT 0,
  slice_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'success', 'failed')),
  error_message TEXT,
  stats JSONB NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE public.urr_compute_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read urr runs" ON public.urr_compute_runs;
CREATE POLICY "Anyone can read urr runs"
  ON public.urr_compute_runs FOR SELECT USING (true);

CREATE INDEX IF NOT EXISTS idx_urr_runs_started ON public.urr_compute_runs(started_at DESC);
