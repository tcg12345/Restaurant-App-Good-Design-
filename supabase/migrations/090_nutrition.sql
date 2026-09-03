-- 090: nutrition (entitlements 'nutrition').
--
-- Formal recipes get a per-serving nutrition column (home meals keep it in
-- their blob). The recipe page's "Estimate nutrition" draws on its own
-- Pro-only allowance: free is 0 (Pro-only), Pro 60 an hour.

ALTER TABLE public.recipes ADD COLUMN IF NOT EXISTS nutrition jsonb;

INSERT INTO public.plan_limits (plan, endpoint, window_kind, max_count) VALUES
  ('pro',  'nutrition-estimate', 'hour', 60),
  ('free', 'nutrition-estimate', 'hour',  0)
ON CONFLICT (plan, endpoint, window_kind) DO UPDATE SET max_count = EXCLUDED.max_count;
