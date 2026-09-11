-- Pin built-in lookup and require schema qualification in reviewed functions.
-- Every application relation/helper in these definitions is already qualified.
-- The optional lookup keeps fresh installations compatible with retired RPCs.
DO $migration$
DECLARE signature text; target regprocedure;
BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'public.ai_window_end(text,timestamp with time zone)',
    'public.ai_window_start(text,timestamp with time zone)',
    'public.check_rate_limit(uuid,text,integer,integer)',
    'public.cuisine_auto_apply_votes()',
    'public.cuisine_lookup_ttl_days()',
    'public.cuisine_max_count()',
    'public.cuisine_source_confidence(text)',
    'public.cuisine_source_is_removable(text)',
    'public.get_friends_with_scores(uuid)',
    'public.guard_profile_verification()',
    'public.guard_restaurant_cuisine()',
    'public.guard_restaurant_cuisine_tags()',
    'public.normalize_text(text)',
    'public.reset_cuisine_suggestion_verdict()',
    'public.update_updated_at_column()'
  ] LOOP
    target := to_regprocedure(signature);
    IF target IS NOT NULL THEN
      EXECUTE format('ALTER FUNCTION %s SET search_path = %L', target, '');
    END IF;
  END LOOP;

  -- This legacy server helper accepts an arbitrary user and time window and
  -- deletes old rate-limit rows. It is not a client API. Preserve trusted
  -- server callers; clients must use their authenticated, scoped endpoints.
  target := to_regprocedure('public.check_rate_limit(uuid,text,integer,integer)');
  IF target IS NOT NULL THEN
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', target);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', target);
  END IF;
END;
$migration$;
