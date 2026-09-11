-- Retired functions from the legacy profiles/restaurants model have no current
-- app callers. Caller-supplied identities are not authorization, and maintenance
-- functions must not permit clients to update restaurant links across accounts.
-- Keep trusted maintenance access and preserve definitions/dependent objects.
DO $$
DECLARE fn record;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure AS signature FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.prokind='f' AND p.proname=ANY(ARRAY[
      'check_email_exists', 'get_cached_friend_activity',
      'get_friend_profile_with_all_data', 'get_friend_profile_with_pagination',
      'get_friends_recent_activity', 'rebuild_friend_activity_cache',
      'link_all_restaurants_systematically', 'link_restaurant_by_place_id',
      'link_restaurants_to_google_places'
    ])
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn.signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn.signature);
  END LOOP;
END $$;
