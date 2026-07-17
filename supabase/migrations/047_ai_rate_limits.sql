-- ═══════════════════════════════════════════════════════
-- Per-user hourly rate limiting for the AI Edge Functions
-- Run this in your Supabase SQL Editor. Safe to run multiple times.
-- ═══════════════════════════════════════════════════════
--
-- The AI functions (location-chat, build-recipe, import-recipe,
-- generate-recipe-image) call consume_ai_rate_limit() on every request so a
-- single account can't burn through the Anthropic/OpenAI budget. Counters are
-- per user × endpoint × clock hour; a caller's expired windows are pruned on
-- their next request.

CREATE TABLE IF NOT EXISTS public.ai_rate_limits (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, endpoint, window_start)
);

-- RLS on with NO policies on purpose: clients never touch the table directly.
-- Only the SECURITY DEFINER function below (and the service role) can write it.
ALTER TABLE public.ai_rate_limits ENABLE ROW LEVEL SECURITY;

-- Atomically count one request against the caller's current hour window.
-- Returns TRUE while the caller is within p_max_per_hour, FALSE once over.
-- SECURITY DEFINER so it can write the RLS-locked table; a caller invoking it
-- directly can only increment their OWN counter (auth.uid()), which gains an
-- attacker nothing.
CREATE OR REPLACE FUNCTION public.consume_ai_rate_limit(
  p_endpoint TEXT,
  p_max_per_hour INTEGER
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_window TIMESTAMPTZ := date_trunc('hour', now());
  v_count INTEGER;
BEGIN
  IF v_user IS NULL THEN
    RETURN FALSE;
  END IF;

  -- Prune this caller's expired windows (PK-prefix scan, a handful of rows).
  DELETE FROM public.ai_rate_limits
   WHERE user_id = v_user AND window_start < now() - INTERVAL '24 hours';

  INSERT INTO public.ai_rate_limits AS r (user_id, endpoint, window_start, request_count)
  VALUES (v_user, p_endpoint, v_window, 1)
  ON CONFLICT (user_id, endpoint, window_start)
  DO UPDATE SET request_count = r.request_count + 1
  RETURNING r.request_count INTO v_count;

  RETURN v_count <= p_max_per_hour;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_ai_rate_limit(TEXT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_ai_rate_limit(TEXT, INTEGER) TO authenticated;
