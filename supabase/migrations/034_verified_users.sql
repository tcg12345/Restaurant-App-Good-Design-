-- 034: Verified users — real verification with request/approval flow.
-- Run this in your Supabase SQL Editor.
-- ════════════════════════════════════════════════════════════════════
-- Replaces the self-assigned is_expert flag with an owner-approved
-- is_verified flag plus a user-chosen public status line.
--
--   • user_profiles gains is_verified + verified_status. Existing experts
--     are grandfathered (is_verified = true).
--   • is_expert is KEPT but frozen: old deployed clients include it in
--     their profile upsert — dropping the column would break their whole
--     profile save. A guard trigger silently ignores client-side changes
--     to both flags, and approval mirrors is_expert = true so old clients
--     still render badges for newly verified users.
--   • verification_requests holds applications. Users insert their own
--     pending request and read their own rows; admins read everything.
--     There are deliberately NO client update/delete policies — the
--     lifecycle (approve / deny / acknowledge) runs through SECURITY
--     DEFINER RPCs only.
--   • app_admins is the allowlist for reviewers. RLS is enabled with no
--     policies, so the table is invisible to clients; membership is
--     checked via the is_app_admin() definer function.

-- ── 1. Profile columns + grandfather ────────────────────────────────

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS is_verified BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS verified_status TEXT
  CHECK (verified_status IS NULL OR char_length(verified_status) <= 80);

UPDATE public.user_profiles SET is_verified = true WHERE is_expert = true;

-- ── 2. Self-grant guard ──────────────────────────────────────────────
-- SECURITY INVOKER (the default) is load-bearing: PostgREST requests run
-- as role authenticated/anon, while SECURITY DEFINER RPCs run as the
-- function owner and service-role/dashboard writes run as service_role/
-- postgres. A DEFINER trigger function would always look privileged and
-- the check would be useless.
--
-- The revert is SILENT (never raise): old clients still send is_expert
-- inside their profile upsert, and their saves must keep succeeding.

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
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_profile_verification ON public.user_profiles;
CREATE TRIGGER trg_guard_profile_verification
  BEFORE INSERT OR UPDATE ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_profile_verification();

-- ── 3. Admin allowlist ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.app_admins (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- RLS on with zero policies: clients can neither read nor write the
-- allowlist. Membership is only observable through is_app_admin().
ALTER TABLE public.app_admins ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_app_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.app_admins WHERE user_id = auth.uid()
  );
$$;

REVOKE ALL ON FUNCTION public.is_app_admin() FROM public;
GRANT EXECUTE ON FUNCTION public.is_app_admin() TO authenticated;

-- Seed the owner as the first admin. If this account doesn't exist yet in
-- this environment, the INSERT matches zero rows — re-run just this
-- statement after the account is created.
INSERT INTO public.app_admins (user_id)
  SELECT id FROM auth.users WHERE lower(email) = 'tyler.gorin@gmail.com'
  ON CONFLICT DO NOTHING;

-- ── 4. Verification requests ─────────────────────────────────────────
-- FK targets user_profiles (not auth.users) so PostgREST can embed the
-- applicant's profile in the admin list; deletes still cascade from
-- auth.users transitively through user_profiles.

CREATE TABLE IF NOT EXISTS public.verification_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.user_profiles(user_id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied')),
  -- Application: identity
  full_name TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  -- Application: professional
  occupation TEXT NOT NULL DEFAULT '',
  affiliation TEXT NOT NULL DEFAULT '',
  credentials TEXT NOT NULL DEFAULT '',
  -- Application: social presence — [{ platform, url, followers }]
  links JSONB NOT NULL DEFAULT '[]',
  -- Application: statement
  statement TEXT NOT NULL DEFAULT '',
  -- Review outcome
  reviewed_by UUID,
  reviewed_at TIMESTAMPTZ,
  deny_reason TEXT,
  -- Set once the applicant has seen the outcome message in-app.
  acknowledged BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One live application at a time; resubmission is allowed once the
-- previous one is decided. Client maps error 23505 to a friendly
-- "already under review" message.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_pending_verification
  ON public.verification_requests(user_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_verification_requests_status
  ON public.verification_requests(status, created_at DESC);

ALTER TABLE public.verification_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read own or admin" ON public.verification_requests;
CREATE POLICY "Read own or admin"
  ON public.verification_requests FOR SELECT
  USING (auth.uid() = user_id OR public.is_app_admin());

DROP POLICY IF EXISTS "Insert own pending" ON public.verification_requests;
CREATE POLICY "Insert own pending"
  ON public.verification_requests FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND status = 'pending'
    AND reviewed_by IS NULL
    AND reviewed_at IS NULL
    AND deny_reason IS NULL
    AND acknowledged = false
  );
-- Deliberately NO update/delete policies: the lifecycle below is the only
-- way a request changes.

-- ── 5. Lifecycle RPCs ────────────────────────────────────────────────

-- Approve: flips the request and grants the badge. Mirrors is_expert so
-- old deployed clients keep rendering badges for newly verified users.
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
        updated_at = now()
    WHERE user_id = req.user_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.deny_verification(p_request_id uuid, p_reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_app_admin() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  UPDATE public.verification_requests
    SET status = 'denied',
        reviewed_by = auth.uid(),
        reviewed_at = now(),
        deny_reason = nullif(trim(p_reason), ''),
        acknowledged = false,
        updated_at = now()
    WHERE id = p_request_id AND status = 'pending';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'request not found or already decided';
  END IF;
END;
$$;

-- Applicant marks the outcome message as seen.
CREATE OR REPLACE FUNCTION public.acknowledge_verification(p_request_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  UPDATE public.verification_requests
    SET acknowledged = true, updated_at = now()
    WHERE id = p_request_id
      AND user_id = auth.uid()
      AND status IN ('approved', 'denied');
$$;

REVOKE ALL ON FUNCTION public.approve_verification(uuid) FROM public;
REVOKE ALL ON FUNCTION public.deny_verification(uuid, text) FROM public;
REVOKE ALL ON FUNCTION public.acknowledge_verification(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.approve_verification(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.deny_verification(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.acknowledge_verification(uuid) TO authenticated;
