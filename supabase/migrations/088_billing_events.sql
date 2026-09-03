-- 088: Billing events — what the paywall did, so launch can be measured.
-- ════════════════════════════════════════════════════════════════════
-- paywall_shown (source, feature) · plan_selected · purchase_started ·
-- purchased · restored · purchase_failed · paywall_dismissed. Written by the
-- client as itself (INSERT own rows only), read by nobody but the service
-- role and the SQL editor. Same shape as onboarding_events (075).
--
-- Idempotent; safe on an already-migrated database.

CREATE TABLE IF NOT EXISTS public.billing_events (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  event TEXT NOT NULL CHECK (char_length(event) BETWEEN 1 AND 40),
  source TEXT,
  feature TEXT,
  plan TEXT,
  platform TEXT,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_billing_events_event ON public.billing_events(event, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_billing_events_user ON public.billing_events(user_id, created_at DESC);

ALTER TABLE public.billing_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can log own billing events" ON public.billing_events;
CREATE POLICY "Users can log own billing events"
  ON public.billing_events FOR INSERT
  WITH CHECK (auth.uid() = user_id);

REVOKE ALL ON public.billing_events FROM PUBLIC, anon;
GRANT INSERT ON public.billing_events TO authenticated;
GRANT USAGE ON SEQUENCE public.billing_events_id_seq TO authenticated;
GRANT ALL ON public.billing_events TO service_role;

NOTIFY pgrst, 'reload schema';
