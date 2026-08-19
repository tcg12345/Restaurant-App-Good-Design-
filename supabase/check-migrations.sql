-- Did 067, 068 and 069 land? One row per thing each migration creates.
-- Reads catalogue definitions rather than calling anything, so it still
-- answers on a database where none of them have run.
SELECT * FROM (VALUES
  ('067', 'user_profiles home_city / home_lat / home_lng',
     (SELECT count(*) FROM information_schema.columns
       WHERE table_schema='public' AND table_name='user_profiles'
         AND column_name IN ('home_city','home_lat','home_lng')) = 3),
  ('067', 'user_profiles bio / is_public / taste_profile',
     (SELECT count(*) FROM information_schema.columns
       WHERE table_schema='public' AND table_name='user_profiles'
         AND column_name IN ('bio','is_public','taste_profile')) = 3),
  ('068', 'restaurant_cuisine table',
     to_regclass('public.restaurant_cuisine') IS NOT NULL),
  ('068', 'guard trigger on restaurant_cuisine',
     EXISTS (SELECT 1 FROM pg_trigger
              WHERE tgname='trg_guard_restaurant_cuisine' AND NOT tgisinternal)),
  ('069', 'cuisine_suggestions table',
     to_regclass('public.cuisine_suggestions') IS NOT NULL),
  ('069', 'approve + deny RPCs',
     (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname='public'
         AND p.proname IN ('approve_cuisine_suggestion','deny_cuisine_suggestion')) = 2),
  ('069', 'auto-apply trigger',
     EXISTS (SELECT 1 FROM pg_trigger
              WHERE tgname='trg_on_cuisine_suggestion' AND NOT tgisinternal)),
  ('069', 'reviewed tiers added, direct-write tier retired',
     EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
              WHERE n.nspname='public' AND p.proname='cuisine_source_confidence'
                AND p.prosrc LIKE '%approved%' AND p.prosrc LIKE '%consensus%')),
  ('069', 'clients blocked from writing reviewed tiers',
     EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
              WHERE n.nspname='public' AND p.proname='guard_restaurant_cuisine'
                AND p.prosrc LIKE '%authenticated%'))
) AS t(migration, check_name, ok)
ORDER BY migration, check_name;
