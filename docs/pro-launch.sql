-- GoodEats Pro — launch day.
--
-- Run in the Supabase SQL editor (as postgres), one block at a time, in
-- order. Grants go in BEFORE the gates flip so nobody is briefly free.
-- Every statement is safe to run twice.
--
-- The SQL editor has no signed-in user, so the admin RPCs
-- (set_billing_gates, admin_grant_pro) would refuse with "Admins only";
-- this file writes the same rows directly.

-- ── 0. Where things stand ───────────────────────────────────────────
SELECT gates_enabled, updated_at FROM public.billing_settings;
SELECT count(*) AS accounts FROM auth.users;
SELECT count(*) AS already_granted
  FROM public.pro_grants WHERE reason = 'launch_30d';

-- ── 1. Grandfather every existing account: 30 days of Pro ───────────
-- One grant per account; accounts that already hold a launch grant are
-- skipped, so a second run adds nothing.
INSERT INTO public.pro_grants (user_id, reason, expires_at)
SELECT u.id, 'launch_30d', now() + INTERVAL '30 days'
  FROM auth.users u
 WHERE NOT EXISTS (
   SELECT 1 FROM public.pro_grants g
    WHERE g.user_id = u.id AND g.reason = 'launch_30d'
 );

-- ── 2. Turn the gates on ────────────────────────────────────────────
-- From here, effective_plan() answers 'free' for anyone without a plan
-- row or a live grant. Phones pick it up on their next foreground
-- (PlanContext refreshes on visibility); nothing needs a reinstall.
UPDATE public.billing_settings
   SET gates_enabled = true, updated_at = now();

-- ── 3. Check ────────────────────────────────────────────────────────
SELECT gates_enabled FROM public.billing_settings;               -- true
SELECT count(*) AS live_launch_grants
  FROM public.pro_grants
 WHERE reason = 'launch_30d' AND expires_at > now();             -- = accounts
SELECT plan, endpoint, window_kind, max_count
  FROM public.plan_limits ORDER BY plan, endpoint;               -- the allowances

-- ── Rollback (if launch day goes wrong) ─────────────────────────────
-- Gates off = everyone is Pro again, instantly, grants untouched.
-- UPDATE public.billing_settings SET gates_enabled = false, updated_at = now();

-- ── Later: give one person Pro by hand ──────────────────────────────
-- INSERT INTO public.pro_grants (user_id, reason, expires_at)
-- SELECT id, 'admin', NULL FROM auth.users WHERE email = 'someone@example.com';
--   (expires_at NULL = for good; a date = until then)
