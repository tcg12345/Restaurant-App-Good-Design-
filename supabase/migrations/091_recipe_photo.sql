-- 091: recreate a dish from a photo (entitlements 'recipe-photo').
--
-- The "Recreate a dish" flow sends Opus ONE photo of a plated dish and
-- gets a recipe back. Opus with an image attached is the most expensive
-- single call in the app, so it draws on its own bucket rather than
-- sharing 'build-recipe'. Pro-only at launch (free = 0 → 402 pro_required);
-- raising the free row is the one-line switch to open it up.

INSERT INTO public.plan_limits (plan, endpoint, window_kind, max_count) VALUES
  ('pro',  'build-recipe-photo', 'hour', 30),
  ('free', 'build-recipe-photo', 'hour',  0)
ON CONFLICT (plan, endpoint, window_kind) DO UPDATE SET max_count = EXCLUDED.max_count;
