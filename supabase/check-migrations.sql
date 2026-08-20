-- Did 067 through 073 land? One row per thing each migration creates.
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
                AND p.prosrc LIKE '%authenticated%')),
  ('070', 'osm source ranked',
     EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
              WHERE n.nspname='public' AND p.proname='cuisine_source_confidence'
                AND p.prosrc LIKE '%''osm''%')),
  ('070', 'osm locked to the server',
     EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
              WHERE n.nspname='public' AND p.proname='guard_restaurant_cuisine'
                AND p.prosrc LIKE '%''osm''%')),
  ('070', 'restaurant_cuisine_lookups table',
     to_regclass('public.restaurant_cuisine_lookups') IS NOT NULL),
  ('070', 'lookups table has RLS on and no client policies',
     coalesce((SELECT c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                WHERE n.nspname='public' AND c.relname='restaurant_cuisine_lookups'), false)
     AND NOT EXISTS (SELECT 1 FROM pg_policies
                      WHERE schemaname='public' AND tablename='restaurant_cuisine_lookups')),
  ('071', 'cuisine cap is 3',
     EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
              WHERE n.nspname='public' AND p.proname='cuisine_max_count')),
  ('071', 'restaurant_cuisine_tags table',
     to_regclass('public.restaurant_cuisine_tags') IS NOT NULL),
  ('071', 'tags are server-write-only (read policy, no write policies)',
     (SELECT count(*) FROM pg_policies
       WHERE schemaname='public' AND tablename='restaurant_cuisine_tags') = 1),
  ('071', 'approve takes an add/primary mode',
     EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
              WHERE n.nspname='public' AND p.proname='approve_cuisine_suggestion'
                AND p.pronargs = 2)),
  ('071', 'admin can remove a cuisine',
     EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
              WHERE n.nspname='public' AND p.proname='remove_restaurant_cuisine')),
  ('072', 'you may re-suggest after a decision',
     EXISTS (SELECT 1 FROM pg_policies
              WHERE schemaname='public' AND tablename='cuisine_suggestions'
                AND cmd='UPDATE' AND qual NOT LIKE '%pending%')),
  ('072', 'a re-suggested row loses its old verdict',
     EXISTS (SELECT 1 FROM pg_trigger
              WHERE tgname='trg_reset_cuisine_suggestion_verdict' AND NOT tgisinternal)),
  ('073', 'provider cuisines are not removable',
     EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
              WHERE n.nspname='public' AND p.proname='cuisine_source_is_removable'))
) AS t(migration, check_name, ok)
ORDER BY migration, check_name;
