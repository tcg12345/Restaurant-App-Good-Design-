-- 035: Verified accounts are always public.
-- Run this in your Supabase SQL Editor (after 034_verified_users.sql).
-- ════════════════════════════════════════════════════════════════════
-- A verified badge is a public-trust signal — a private verified account
-- would be contradictory (their picks/ratings wouldn't be visible). Three
-- layers keep the invariant:
--   1. The guard trigger forces is_public = true on any row where
--      is_verified is true (client attempts to go private are silently
--      overridden; the Settings toggle is also disabled in the app).
--   2. The approve RPC flips is_public = true at approval time.
--   3. A one-time backfill fixes any already-verified private rows.

-- ── 1. Guard trigger (replaces 034's version; adds the is_public force) ──
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

-- (The trigger itself already points at this function; no re-create needed,
-- but keep it idempotent for fresh environments running 034+035 together.)
DROP TRIGGER IF EXISTS trg_guard_profile_verification ON public.user_profiles;
CREATE TRIGGER trg_guard_profile_verification
  BEFORE INSERT OR UPDATE ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_profile_verification();

-- ── 2. Approve RPC (replaces 034's version; adds is_public = true) ──
CREATE OR REPLACE FUNCTION public.approve_verification(p_request_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  req public.verification_requests%ROWTYPE;
BEGIN
  IF NOT public.is_app_admin() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  SELECT * INTO req FROM public.verification_requests
    WHERE id = p_request_id AND status = 'pending'
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'request not found or already decided';
  END IF;
  UPDATE public.verification_requests
    SET status = 'approved',
        reviewed_by = auth.uid(),
        reviewed_at = now(),
        deny_reason = NULL,
        acknowledged = false,
        updated_at = now()
    WHERE id = p_request_id;
  UPDATE public.user_profiles
    SET is_verified = true,
        is_expert = true,
        is_public = true,
        updated_at = now()
    WHERE user_id = req.user_id;
END;
$$;

-- ── 3. Backfill: any already-verified private accounts become public ──
UPDATE public.user_profiles SET is_public = true
  WHERE is_verified = true AND is_public = false;
