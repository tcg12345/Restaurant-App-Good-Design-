-- 076: Make the onboarding funnel readable, and bound what can be written.
--
-- 075 created onboarding_events with an INSERT policy for anon and
-- authenticated and no SELECT policy, which is correct for a write-only
-- client sink — the dashboard and service role bypass RLS, so the events
-- were always readable there. What was missing is a way to read it that
-- doesn't require pasting SQL, and any bound at all on what anon can
-- write: `WITH CHECK (true)` accepts unlimited rows with arbitrary event
-- strings from anyone holding the publishable key.
--
-- Run AFTER 075.

DO $$
BEGIN
  IF to_regclass('public.onboarding_events') IS NULL THEN
    RAISE EXCEPTION 'public.onboarding_events is missing — run 075_onboarding_events.sql first.';
  END IF;
END $$;

-- ── 1. Bound the writes ──────────────────────────────────────────────
-- Event names are emitted by lib/onboarding-events.ts and are always short
-- snake_case identifiers. Anything else is not our client.
ALTER TABLE public.onboarding_events
  DROP CONSTRAINT IF EXISTS onboarding_events_event_shape;
ALTER TABLE public.onboarding_events
  ADD CONSTRAINT onboarding_events_event_shape
  CHECK (event ~ '^[a-z][a-z0-9_]{0,63}$');

ALTER TABLE public.onboarding_events
  DROP CONSTRAINT IF EXISTS onboarding_events_anon_shape;
ALTER TABLE public.onboarding_events
  ADD CONSTRAINT onboarding_events_anon_shape
  CHECK (char_length(anon_id) BETWEEN 1 AND 64);

-- ── 2. A read path for admins ────────────────────────────────────────
-- Through is_app_admin() (migration 034), NOT a subquery against
-- app_admins: that table has RLS on with zero policies by design, so a
-- direct subquery returns no rows for everyone and the policy could never
-- be true. Membership is only observable through the definer function.
-- Still no UPDATE/DELETE for anyone — the table is append-only.
DROP POLICY IF EXISTS "Admins can read onboarding events" ON public.onboarding_events;
CREATE POLICY "Admins can read onboarding events"
  ON public.onboarding_events FOR SELECT
  TO authenticated
  USING (public.is_app_admin());

-- ── 3. The funnel, as one query ──────────────────────────────────────
-- Per event: how many distinct installs reached it, how many of those were
-- signed in by then, and when it was first and last seen. Ordered by first
-- appearance so the rows read top-to-bottom as the flow itself.
CREATE OR REPLACE VIEW public.onboarding_funnel AS
  SELECT
    event,
    count(DISTINCT anon_id) AS installs,
    count(DISTINCT user_id) AS accounts,
    min(created_at)         AS first_seen,
    max(created_at)         AS last_seen
  FROM public.onboarding_events
  GROUP BY event
  ORDER BY min(created_at);

-- security_invoker: the view runs as the CALLER, so the SELECT policy above
-- still applies. Without it the view would silently hand its owner's
-- privileges to anyone who could select from it.
ALTER VIEW public.onboarding_funnel SET (security_invoker = on);

GRANT SELECT ON public.onboarding_funnel TO authenticated;
