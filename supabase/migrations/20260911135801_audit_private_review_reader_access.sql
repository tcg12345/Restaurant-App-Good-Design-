-- Retired review readers bypass the legacy profile visibility rules and accept
-- caller-supplied viewer identities. The active taste helper is internal: its
-- SECURITY DEFINER wrappers apply the appropriate audience/identity filters.
-- Remove direct client access while preserving owner and trusted server calls.
DO $$
DECLARE fn record;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure AS signature FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.prokind='f' AND p.proname=ANY(ARRAY[
      'get_friend_rating_stats', 'get_friend_reviews_for_place',
      'get_restaurant_community_stats', 'get_restaurant_reviews',
      'taste_user_stats_impl'
    ])
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn.signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn.signature);
  END LOOP;
END $$;
