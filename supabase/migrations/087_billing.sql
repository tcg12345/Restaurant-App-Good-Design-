-- 087: Billing — the GoodEats Pro plan on the server.
-- ════════════════════════════════════════════════════════════════════
-- Phase 1 of the Pro plan (docs/pro-subscription-plan.md). This migration
-- gives the database everything the plan needs and changes NOTHING for
-- anyone yet: the gates ship switched off.
--
--   user_profiles.plan (+ pro_until, pro_source, pro_will_renew,
--   stripe_customer_id)   what the person is on. Readable by the client
--                         like any profile column (select('*') already
--                         brings it), never writable by it — the same
--                         guard trigger that protects is_verified reverts
--                         client writes. Only the billing edge functions
--                         (service role) set it.
--   subscription_events   every RevenueCat webhook, keyed by its event id,
--                         so a replayed delivery is a no-op.
--   pro_grants            Pro without a purchase: launch grandfathering,
--                         promo codes, an admin's say-so. Each has an
--                         expiry.
--   billing_settings      one row. gates_enabled = false until launch;
--                         while it's false every account is treated as
--                         Pro, so seeding the free-plan limits here is
--                         safe.
--   plan_limits           the allowances, per plan × endpoint × window
--                         (hour/day/week/month). A max of 0 means "Pro
--                         only". Pro rows are today's abuse caps; free
--                         rows are the decided launch values.
--   ai_usage              counters per user × endpoint × window kind ×
--                         window start. Replaces ai_rate_limits (047),
--                         which only knew hours.
--   consume_ai_quota()    the one call every AI function makes. Checks
--                         every window for the caller's EFFECTIVE plan,
--                         increments them all, and says what's left.
--   get_ai_quota_status() the same numbers without consuming — for
--                         "2 of 3 left this week" meters (Phase 2).
--
-- Idempotent; safe on an already-migrated database. Run it in the Supabase
-- SQL Editor. Seeds use ON CONFLICT DO UPDATE, so re-running it after
-- changing a number applies the new number.

-- ── user_profiles: the plan columns ────────────────────────────────
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'free',
  ADD COLUMN IF NOT EXISTS pro_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pro_source TEXT,
  ADD COLUMN IF NOT EXISTS pro_will_renew BOOLEAN,
  ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;
ALTER TABLE public.user_profiles DROP CONSTRAINT IF EXISTS user_profiles_plan_check;
ALTER TABLE public.user_profiles
  ADD CONSTRAINT user_profiles_plan_check CHECK (plan IN ('free', 'pro'));

-- The guard trigger from 034/035, extended: client writes to the plan
-- columns are reverted the same way client writes to is_verified are.
-- Everything else in the body is unchanged from 035.
CREATE OR REPLACE FUNCTION public.guard_profile_verification()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  privileged BOOLEAN := current_user NOT IN ('authenticated', 'anon');
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT privileged THEN
      NEW.is_verified := false;
      NEW.is_expert := false;
      NEW.verified_status := NULL;
      NEW.plan := 'free';
      NEW.pro_until := NULL;
      NEW.pro_source := NULL;
      NEW.pro_will_renew := NULL;
      NEW.stripe_customer_id := NULL;
    END IF;
  ELSE
    IF NOT privileged THEN
      NEW.is_verified := OLD.is_verified;
      NEW.is_expert := OLD.is_expert;
      -- A verified user may edit their own public status line; everyone
      -- else's attempts are reverted.
      IF NOT OLD.is_verified THEN
        NEW.verified_status := OLD.verified_status;
      END IF;
      NEW.plan := OLD.plan;
      NEW.pro_until := OLD.pro_until;
      NEW.pro_source := OLD.pro_source;
      NEW.pro_will_renew := OLD.pro_will_renew;
      NEW.stripe_customer_id := OLD.stripe_customer_id;
    END IF;
  END IF;
  -- The status line only exists alongside the badge.
  IF NOT NEW.is_verified THEN
    NEW.verified_status := NULL;
  END IF;
  -- Verified accounts are always public (runs after the revert logic so a
  -- verified user flipping is_public off is overridden).
  IF NEW.is_verified THEN
    NEW.is_public := true;
  END IF;
  RETURN NEW;
END;
$$;

-- ── Billing tables (RLS on, no policies: service role + definer RPCs only) ──
CREATE TABLE IF NOT EXISTS public.billing_settings (
  id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
  gates_enabled BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO public.billing_settings (id, gates_enabled) VALUES (true, false) ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.billing_settings ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.subscription_events (
  id TEXT PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  store TEXT,
  environment TEXT,
  product_id TEXT,
  expires_at TIMESTAMPTZ,
  payload JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_subscription_events_user ON public.subscription_events(user_id, received_at DESC);
ALTER TABLE public.subscription_events ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.pro_grants (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  expires_at TIMESTAMPTZ,
  granted_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pro_grants_user ON public.pro_grants(user_id, expires_at);
ALTER TABLE public.pro_grants ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.plan_limits (
  plan TEXT NOT NULL CHECK (plan IN ('free', 'pro')),
  endpoint TEXT NOT NULL,
  window_kind TEXT NOT NULL CHECK (window_kind IN ('hour', 'day', 'week', 'month')),
  max_count INTEGER NOT NULL CHECK (max_count >= 0),
  PRIMARY KEY (plan, endpoint, window_kind)
);
ALTER TABLE public.plan_limits ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.ai_usage (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  window_kind TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, endpoint, window_kind, window_start)
);
ALTER TABLE public.ai_usage ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.billing_settings, public.subscription_events, public.pro_grants, public.plan_limits, public.ai_usage FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.billing_settings, public.subscription_events, public.pro_grants, public.plan_limits, public.ai_usage TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.pro_grants_id_seq TO service_role;

-- ── Seed the allowances ────────────────────────────────────────────
-- pro = today's abuse caps (unchanged behaviour). free = the launch
-- values decided 2026-09-02. 0 = Pro only.
INSERT INTO public.plan_limits (plan, endpoint, window_kind, max_count) VALUES
  ('pro',  'location-chat',         'hour',  120),
  ('pro',  'build-recipe',          'hour',   40),
  ('pro',  'build-recipe-ideas',    'hour',   80),
  ('pro',  'import-recipe',         'hour',   30),
  ('pro',  'import-recipe-text',    'hour',   30),
  ('pro',  'import-recipe-photo',   'hour',   30),
  ('pro',  'generate-recipe-image', 'hour',   20),
  ('pro',  'import-restaurants',    'hour',   20),
  ('pro',  'cuisine-lookup',        'hour',  120),
  ('free', 'location-chat',         'hour',   10),
  ('free', 'build-recipe',          'week',    5),
  ('free', 'build-recipe-ideas',    'day',     5),
  ('free', 'import-recipe',         'week',    5),
  ('free', 'import-recipe-text',    'week',    3),
  ('free', 'import-recipe-photo',   'hour',    0),
  ('free', 'generate-recipe-image', 'hour',    0),
  ('free', 'import-restaurants',    'hour',   20),
  ('free', 'cuisine-lookup',        'hour',  120)
ON CONFLICT (plan, endpoint, window_kind) DO UPDATE SET max_count = EXCLUDED.max_count;

-- ── The plan questions ─────────────────────────────────────────────
-- Is the caller on Pro right now: an active plan row, or a live grant.
CREATE OR REPLACE FUNCTION public.is_pro()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT auth.uid() IS NOT NULL AND (
    EXISTS (
      SELECT 1 FROM public.user_profiles p
       WHERE p.user_id = auth.uid() AND p.plan = 'pro'
         AND (p.pro_until IS NULL OR p.pro_until > now())
    )
    OR EXISTS (
      SELECT 1 FROM public.pro_grants g
       WHERE g.user_id = auth.uid() AND (g.expires_at IS NULL OR g.expires_at > now())
    )
  );
$$;
REVOKE ALL ON FUNCTION public.is_pro() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_pro() TO authenticated, service_role;

-- The plan the limits apply: while the gates are off, everyone is Pro.
CREATE OR REPLACE FUNCTION public.effective_plan()
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT CASE
    WHEN NOT COALESCE((SELECT s.gates_enabled FROM public.billing_settings s WHERE s.id), false) THEN 'pro'
    WHEN public.is_pro() THEN 'pro'
    ELSE 'free'
  END;
$$;
REVOKE ALL ON FUNCTION public.effective_plan() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.effective_plan() TO authenticated, service_role;

-- Everything the client needs to draw plan state in one call.
CREATE OR REPLACE FUNCTION public.get_plan_context()
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'is_pro', public.is_pro(),
    'effective_plan', public.effective_plan(),
    'gates_enabled', COALESCE((SELECT s.gates_enabled FROM public.billing_settings s WHERE s.id), false),
    'grant_until', (SELECT max(COALESCE(g.expires_at, 'infinity'::timestamptz)) FROM public.pro_grants g
                     WHERE g.user_id = auth.uid() AND (g.expires_at IS NULL OR g.expires_at > now()))
  );
$$;
REVOKE ALL ON FUNCTION public.get_plan_context() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_plan_context() TO authenticated;

-- ── Windows ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ai_window_start(p_kind TEXT, p_at TIMESTAMPTZ)
RETURNS TIMESTAMPTZ
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE p_kind
    WHEN 'hour'  THEN date_trunc('hour',  p_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
    WHEN 'day'   THEN date_trunc('day',   p_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
    WHEN 'week'  THEN date_trunc('week',  p_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
    WHEN 'month' THEN date_trunc('month', p_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
  END;
$$;

CREATE OR REPLACE FUNCTION public.ai_window_end(p_kind TEXT, p_start TIMESTAMPTZ)
RETURNS TIMESTAMPTZ
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE p_kind
    WHEN 'hour'  THEN p_start + INTERVAL '1 hour'
    WHEN 'day'   THEN p_start + INTERVAL '1 day'
    WHEN 'week'  THEN p_start + INTERVAL '1 week'
    WHEN 'month' THEN p_start + INTERVAL '1 month'
  END;
$$;

-- ── The quota call ─────────────────────────────────────────────────
-- Returns {allowed, plan, pro_only, remaining, resets_at}. `remaining` is
-- the tightest window's headroom AFTER this request (null when no limit
-- is configured); `resets_at` is when that window turns over. When not
-- allowed, nothing is counted, so a refused request never eats headroom.
CREATE OR REPLACE FUNCTION public.consume_ai_quota(p_endpoint TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_plan TEXT;
  v_now TIMESTAMPTZ := now();
  r RECORD;
  v_count INTEGER;
  v_start TIMESTAMPTZ;
  v_remaining INTEGER := NULL;
  v_resets TIMESTAMPTZ := NULL;
  v_any BOOLEAN := false;
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('allowed', false, 'plan', 'free', 'pro_only', false, 'remaining', 0, 'resets_at', NULL);
  END IF;
  v_plan := public.effective_plan();

  -- Prune this caller's stale windows now and then (cheap PK-prefix scan).
  DELETE FROM public.ai_usage
   WHERE user_id = v_user AND endpoint = p_endpoint AND window_start < v_now - INTERVAL '35 days';

  -- Pass 1: would any window refuse? Report the tightest one.
  FOR r IN SELECT window_kind, max_count FROM public.plan_limits WHERE plan = v_plan AND endpoint = p_endpoint LOOP
    v_any := true;
    v_start := public.ai_window_start(r.window_kind, v_now);
    SELECT request_count INTO v_count FROM public.ai_usage
     WHERE user_id = v_user AND endpoint = p_endpoint AND window_kind = r.window_kind AND window_start = v_start;
    v_count := COALESCE(v_count, 0);
    IF v_count >= r.max_count THEN
      RETURN jsonb_build_object(
        'allowed', false, 'plan', v_plan, 'pro_only', r.max_count = 0,
        'remaining', 0, 'resets_at', public.ai_window_end(r.window_kind, v_start));
    END IF;
    IF v_remaining IS NULL OR (r.max_count - v_count - 1) < v_remaining THEN
      v_remaining := r.max_count - v_count - 1;
      v_resets := public.ai_window_end(r.window_kind, v_start);
    END IF;
  END LOOP;

  -- Pass 2: count it against every window.
  IF v_any THEN
    FOR r IN SELECT window_kind FROM public.plan_limits WHERE plan = v_plan AND endpoint = p_endpoint LOOP
      v_start := public.ai_window_start(r.window_kind, v_now);
      INSERT INTO public.ai_usage AS u (user_id, endpoint, window_kind, window_start, request_count)
      VALUES (v_user, p_endpoint, r.window_kind, v_start, 1)
      ON CONFLICT (user_id, endpoint, window_kind, window_start)
      DO UPDATE SET request_count = u.request_count + 1;
    END LOOP;
  END IF;

  RETURN jsonb_build_object('allowed', true, 'plan', v_plan, 'pro_only', false, 'remaining', v_remaining, 'resets_at', v_resets);
END;
$$;
REVOKE ALL ON FUNCTION public.consume_ai_quota(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_ai_quota(TEXT) TO authenticated;

-- What's left on every endpoint, without consuming. {endpoint: {remaining,
-- max, window, resets_at, pro_only}} for the caller's effective plan.
CREATE OR REPLACE FUNCTION public.get_ai_quota_status()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_plan TEXT := public.effective_plan();
  v_now TIMESTAMPTZ := now();
  r RECORD;
  v_count INTEGER;
  v_start TIMESTAMPTZ;
  v_out JSONB := '{}'::jsonb;
  v_cur JSONB;
  v_left INTEGER;
BEGIN
  IF v_user IS NULL THEN RETURN v_out; END IF;
  FOR r IN SELECT endpoint, window_kind, max_count FROM public.plan_limits WHERE plan = v_plan ORDER BY endpoint LOOP
    v_start := public.ai_window_start(r.window_kind, v_now);
    SELECT request_count INTO v_count FROM public.ai_usage
     WHERE user_id = v_user AND endpoint = r.endpoint AND window_kind = r.window_kind AND window_start = v_start;
    v_left := GREATEST(0, r.max_count - COALESCE(v_count, 0));
    v_cur := v_out -> r.endpoint;
    -- Keep the tightest window per endpoint.
    IF v_cur IS NULL OR v_left < (v_cur ->> 'remaining')::int THEN
      v_out := v_out || jsonb_build_object(r.endpoint, jsonb_build_object(
        'remaining', v_left, 'max', r.max_count, 'window', r.window_kind,
        'resets_at', public.ai_window_end(r.window_kind, v_start), 'pro_only', r.max_count = 0));
    END IF;
  END LOOP;
  RETURN jsonb_build_object('plan', v_plan, 'endpoints', v_out);
END;
$$;
REVOKE ALL ON FUNCTION public.get_ai_quota_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_ai_quota_status() TO authenticated;

-- ── Admin switches ─────────────────────────────────────────────────
-- Flip the gates (launch day) and grant Pro by hand. Both require the
-- app_admins allowlist from migration 034.
CREATE OR REPLACE FUNCTION public.set_billing_gates(p_enabled BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_app_admin() THEN RAISE EXCEPTION 'Admins only'; END IF;
  UPDATE public.billing_settings SET gates_enabled = p_enabled, updated_at = now() WHERE id;
END;
$$;
REVOKE ALL ON FUNCTION public.set_billing_gates(BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_billing_gates(BOOLEAN) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_grant_pro(p_user UUID, p_reason TEXT, p_expires TIMESTAMPTZ)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_app_admin() THEN RAISE EXCEPTION 'Admins only'; END IF;
  INSERT INTO public.pro_grants (user_id, reason, expires_at, granted_by)
  VALUES (p_user, p_reason, p_expires, auth.uid());
END;
$$;
REVOKE ALL ON FUNCTION public.admin_grant_pro(UUID, TEXT, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_grant_pro(UUID, TEXT, TIMESTAMPTZ) TO authenticated;

-- Launch-day helper (run by hand, as postgres): every account that exists
-- gets 30 days of Pro.
--   INSERT INTO public.pro_grants (user_id, reason, expires_at)
--   SELECT id, 'launch_30d', now() + INTERVAL '30 days' FROM auth.users
--   ON CONFLICT DO NOTHING;

NOTIFY pgrst, 'reload schema';

-- ── Verify ─────────────────────────────────────────────────────────
--   SELECT public.effective_plan();            -- 'pro' while gates are off
--   SELECT public.consume_ai_quota('location-chat');
--   SELECT public.get_ai_quota_status();
