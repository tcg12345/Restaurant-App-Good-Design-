-- ── Onboarding taste quiz persistence ────────────────────────────────────
-- The palette test (src/pages/Onboarding.tsx) used to discard its answers on
-- finish. Store them on the profile row so cold-start recommendations can
-- blend the stated cuisine preferences in as priors (lib/recommendations.ts)
-- and the signal follows the account across devices.
--
-- Shape (all optional): { atmosphere, flavor, cuisines: text[], frequency,
-- completedAt } — written by lib/taste-quiz.ts only.
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS taste_profile JSONB;
