-- 075: Onboarding funnel events.
--
-- The signup flow is being reordered around a claim ("value before the
-- auth gate converts better"). This table is how that claim gets tested
-- on OUR users instead of trusted from a blog post: one row per step a
-- person completes, keyed by a random per-install anon id so the
-- pre-auth stretch (no user yet) still chains into the post-signup
-- stretch (user_id fills in once it exists).
--
-- Write-only from clients, like client_errors (055). Anon INSERT is
-- deliberate — the whole point is measuring people who have no account
-- yet. No select/update/delete policies: read with the dashboard or the
-- service role, e.g.
--   select event, count(distinct anon_id) from onboarding_events
--   group by event order by min(created_at);

CREATE TABLE IF NOT EXISTS public.onboarding_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  anon_id text NOT NULL,
  user_id uuid,
  event text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_onboarding_events_created ON public.onboarding_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_onboarding_events_anon ON public.onboarding_events(anon_id, created_at);

ALTER TABLE public.onboarding_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can log onboarding events" ON public.onboarding_events;
CREATE POLICY "Anyone can log onboarding events"
  ON public.onboarding_events FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);
-- Deliberately NO select/update/delete policies: write-only from clients.
