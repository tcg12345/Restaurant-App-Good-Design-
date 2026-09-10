-- Retired legacy RPCs are not used by the current app. Keep maintenance
-- access for the service role; remove both explicit and inherited PUBLIC grants.
-- Resolve overloads from the catalog so this also works on clean installations
-- where these old, out-of-repository functions never existed.
DO $$
DECLARE fn record;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure AS signature FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.proname = ANY(ARRAY[
      'get_cached_friend_profile', 'build_friend_profile_cache',
      'get_friend_profile_data', 'get_friend_wishlist_data',
      'get_lightning_fast_friend_profile', 'get_friends_with_scores', 'debug_friend_ratings',
      'update_restaurant_google_place_id', 'aggressive_restaurant_linking',
      'auto_link_all_restaurants', 'simple_emergency_link'
    ])
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn.signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn.signature);
  END LOOP;
END $$;

-- A received event is not necessarily applied. Old receipts intentionally
-- remain NULL: a retry of a previously failed delivery must be repairable.
ALTER TABLE public.subscription_events ADD COLUMN IF NOT EXISTS processed_at timestamptz;

CREATE OR REPLACE FUNCTION public.apply_billing_event(event_record jsonb, plan_updates jsonb)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  event_id text := event_record->>'id';
  processed timestamptz;
  item jsonb;
BEGIN
  IF event_id IS NULL OR event_id = '' OR event_record->>'type' IS NULL
     OR jsonb_typeof(plan_updates) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Invalid billing event';
  END IF;

  INSERT INTO public.subscription_events(id,user_id,type,store,environment,product_id,expires_at,payload)
  VALUES(event_id,(event_record->>'user_id')::uuid,event_record->>'type',
    event_record->>'store',event_record->>'environment',event_record->>'product_id',
    (event_record->>'expires_at')::timestamptz,event_record->'payload')
  ON CONFLICT(id) DO NOTHING;

  -- Serializes concurrent deliveries of this ID. Insertion, all profile writes
  -- (including transfers), and completion commit together or roll back together.
  SELECT processed_at INTO processed FROM public.subscription_events WHERE id=event_id FOR UPDATE;
  IF processed IS NOT NULL THEN RETURN false; END IF;

  -- Consistent lock order for events touching more than one account.
  PERFORM user_id FROM public.user_profiles
    WHERE user_id IN (SELECT (value->>'user_id')::uuid FROM jsonb_array_elements(plan_updates))
    ORDER BY user_id FOR UPDATE;

  FOR item IN SELECT value FROM jsonb_array_elements(plan_updates)
  LOOP
    IF (item->>'plan') IS NULL OR (item->>'plan') NOT IN ('free','pro') THEN
      RAISE EXCEPTION 'Invalid plan';
    END IF;
    UPDATE public.user_profiles SET
      plan=item->>'plan', pro_until=(item->>'pro_until')::timestamptz,
      pro_source=item->>'pro_source', pro_will_renew=(item->>'pro_will_renew')::boolean,
      updated_at=now()
    WHERE user_id=(item->>'user_id')::uuid;
    IF NOT FOUND THEN RAISE EXCEPTION 'Billing profile not found'; END IF;
  END LOOP;
  UPDATE public.subscription_events SET processed_at=now() WHERE id=event_id;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.apply_billing_event(jsonb,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_billing_event(jsonb,jsonb) TO service_role;
