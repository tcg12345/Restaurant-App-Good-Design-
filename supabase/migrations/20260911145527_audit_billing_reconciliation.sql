-- Order subscription writes by RevenueCat's authoritative snapshot timestamp.
CREATE TABLE IF NOT EXISTS public.billing_sync_state (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  observed_at_ms bigint NOT NULL DEFAULT 0 CHECK (observed_at_ms >= 0)
);
ALTER TABLE public.billing_sync_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.billing_sync_state FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.billing_sync_state TO service_role;

CREATE OR REPLACE FUNCTION public.apply_billing_snapshot(p_user uuid,p_state jsonb,p_observed_at_ms bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE previous_ms bigint; result jsonb;
BEGIN
  IF p_observed_at_ms IS NULL OR p_observed_at_ms <= 0 OR p_state->>'plan' IS NULL OR p_state->>'plan' NOT IN ('free','pro') THEN
    RAISE EXCEPTION 'Invalid billing snapshot';
  END IF;
  INSERT INTO public.billing_sync_state(user_id) VALUES(p_user) ON CONFLICT DO NOTHING;
  SELECT observed_at_ms INTO previous_ms FROM public.billing_sync_state WHERE user_id=p_user FOR UPDATE;
  IF p_observed_at_ms > previous_ms THEN
    UPDATE public.user_profiles SET plan=p_state->>'plan',pro_until=(p_state->>'pro_until')::timestamptz,
      pro_source=p_state->>'pro_source',pro_will_renew=(p_state->>'pro_will_renew')::boolean,updated_at=now()
    WHERE user_id=p_user;
    IF NOT FOUND THEN RAISE EXCEPTION 'Billing profile not found'; END IF;
    UPDATE public.billing_sync_state SET observed_at_ms=p_observed_at_ms WHERE user_id=p_user;
  END IF;
  SELECT jsonb_build_object('plan',plan,'proUntil',pro_until,'proSource',pro_source,'proWillRenew',pro_will_renew)
    INTO result FROM public.user_profiles WHERE user_id=p_user;
  IF result IS NULL THEN RAISE EXCEPTION 'Billing profile not found'; END IF;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.apply_billing_snapshot(uuid,jsonb,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.apply_billing_snapshot(uuid,jsonb,bigint) TO service_role;

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

  -- Each account's snapshot lock comes before its profile lock. Sorted users
  -- keep transfers and simultaneous restore requests from deadlocking.
  FOR item IN SELECT value FROM jsonb_array_elements(plan_updates) ORDER BY value->>'user_id'
  LOOP
    PERFORM public.apply_billing_snapshot((item->>'user_id')::uuid,item,(item->>'observed_at_ms')::bigint);
  END LOOP;
  UPDATE public.subscription_events SET processed_at=now() WHERE id=event_id;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.apply_billing_event(jsonb,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_billing_event(jsonb,jsonb) TO service_role;
