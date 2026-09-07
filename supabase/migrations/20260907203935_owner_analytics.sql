-- Owner analytics. Apply after existing migrations (requires is_app_admin).
-- Client telemetry is untrusted, write-only, and separate from server API records.
CREATE TABLE public.analytics_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 created_at timestamptz NOT NULL DEFAULT now(),
 occurred_at timestamptz NOT NULL DEFAULT now(),
 user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
 anon_id text NOT NULL CHECK(length(anon_id) BETWEEN 1 AND 80),
 session_id text NOT NULL CHECK(length(session_id) BETWEEN 1 AND 80),
 event text NOT NULL CHECK(event ~ '^[a-z][a-z0-9_]{0,63}$'),
 page text NOT NULL DEFAULT 'unknown' CHECK(length(page) <= 80),
 feature text CHECK(length(feature) <= 80),
 restaurant_id text CHECK(length(restaurant_id) <= 160),
 restaurant_name text CHECK(length(restaurant_name) <= 160),
 duration_ms integer CHECK(duration_ms BETWEEN 0 AND 3600000),
 platform text NOT NULL DEFAULT 'server' CHECK(platform IN ('web','ios','server')),
 app_version text NOT NULL DEFAULT '' CHECK(length(app_version) <= 80),
 origin text NOT NULL DEFAULT 'client' CHECK(origin IN ('client','server')),
 properties jsonb NOT NULL DEFAULT '{}' CHECK ((NOT properties ? 'status' OR properties->>'status' ~ '^[0-9]{1,3}$') AND (NOT properties ? 'result_count' OR properties->>'result_count' ~ '^[0-9]{1,6}$')) CHECK(jsonb_typeof(properties) = 'object' AND octet_length(properties::text) <= 4096)
);
CREATE INDEX analytics_events_time ON public.analytics_events(created_at DESC);
CREATE INDEX analytics_events_user_time ON public.analytics_events(user_id, created_at DESC) WHERE user_id IS NOT NULL;
CREATE INDEX analytics_events_anon_time ON public.analytics_events(anon_id, created_at);
CREATE INDEX analytics_events_restaurant_time ON public.analytics_events(restaurant_id, created_at DESC) WHERE restaurant_id IS NOT NULL;
CREATE INDEX analytics_events_session_time ON public.analytics_events(session_id, created_at);
ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.analytics_events FROM PUBLIC, anon, authenticated;
GRANT INSERT, SELECT ON public.analytics_events TO anon, authenticated;
GRANT ALL ON public.analytics_events TO service_role;
CREATE POLICY analytics_client_insert ON public.analytics_events FOR INSERT TO anon, authenticated
 WITH CHECK (origin = 'client' AND platform IN ('web','ios') AND created_at BETWEEN now() - interval '1 minute' AND now() + interval '1 minute' AND occurred_at BETWEEN now() - interval '1 day' AND now() + interval '1 minute' AND user_id IS NOT DISTINCT FROM (SELECT auth.uid()));
CREATE POLICY analytics_owner_read ON public.analytics_events FOR SELECT TO authenticated USING ((SELECT public.is_app_admin()));

CREATE FUNCTION public.analytics_collect(events jsonb) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE e jsonb;
BEGIN
 IF jsonb_typeof(events) IS DISTINCT FROM 'array' OR jsonb_array_length(events) > 50 OR octet_length(events::text) > 100000 THEN RAISE EXCEPTION 'Invalid analytics batch'; END IF;
 FOR e IN SELECT value FROM jsonb_array_elements(events) LOOP
 BEGIN
 INSERT INTO public.analytics_events(id, occurred_at, user_id, anon_id, session_id, event, page, feature, restaurant_id, restaurant_name, duration_ms, platform, app_version, properties)
 SELECT (e->>'id')::uuid, greatest(now() - interval '1 day', least(now(), (e->>'occurred_at')::timestamptz)), auth.uid(),
 e->>'anon_id', e->>'session_id', e->>'event', left(coalesce(e->>'page','unknown'),80), left(e->>'feature',80), left(e->>'restaurant_id',160), left(e->>'restaurant_name',160),
 least(3600000,greatest(0,(e->>'duration_ms')::integer)), e->>'platform', left(coalesce(e->>'app_version',''),80), coalesce(e->'properties','{}'::jsonb)
 WHERE (e->>'user_id')::uuid IS NOT DISTINCT FROM auth.uid();
 EXCEPTION WHEN unique_violation THEN NULL;
 END;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.analytics_collect(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.analytics_collect(jsonb) TO anon, authenticated;

-- Rates are entered by the owner after checking their provider contract.
-- Exact field-mask matching prevents applying a cheap Places tier to an expensive request.
CREATE TABLE public.analytics_rates (
 provider text NOT NULL, endpoint text NOT NULL, field_mask text NOT NULL DEFAULT '',
 usd_per_1000 numeric NOT NULL CHECK(usd_per_1000 >= 0),
 effective_from timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(provider, endpoint, field_mask, effective_from)
);
ALTER TABLE public.analytics_rates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.analytics_rates FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.analytics_rates TO authenticated;
GRANT ALL ON public.analytics_rates TO service_role;
CREATE POLICY analytics_rates_read ON public.analytics_rates FOR SELECT TO authenticated USING ((SELECT public.is_app_admin()));

CREATE FUNCTION public.analytics_report(days integer DEFAULT 30, platform_filter text DEFAULT NULL, restaurant_sort text DEFAULT 'opens') RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' SET statement_timeout = '15s' AS $$
DECLARE result jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_app_admin() THEN RAISE EXCEPTION 'Admins only' USING ERRCODE = '42501'; END IF;
 IF days NOT BETWEEN 1 AND 90 THEN RAISE EXCEPTION 'Choose 1 to 90 days'; END IF;
 WITH e AS MATERIALIZED (
   SELECT a.*, coalesce(user_id::text, anon_id) actor,
    r.usd_per_1000 / 1000 estimated_cost
   FROM public.analytics_events a
   LEFT JOIN LATERAL (
    SELECT usd_per_1000 FROM public.analytics_rates r
    WHERE a.event='api_request' AND r.provider=a.properties->>'provider' AND r.endpoint=a.properties->>'endpoint'
      AND r.field_mask=coalesce(a.properties->>'field_mask','') AND r.effective_from<=a.created_at
    ORDER BY effective_from DESC LIMIT 1
   ) r ON true
   WHERE a.created_at >= now() - make_interval(days=>days) AND (platform_filter IS NULL OR a.platform=platform_filter)
 ), people AS (
  SELECT coalesce(user_id::text, anon_id) actor, min(created_at) first_seen
  FROM public.analytics_events WHERE event='page_view' AND (platform_filter IS NULL OR platform=platform_filter) GROUP BY 1
 ), sessions AS (
  SELECT session_id, count(*) FILTER (WHERE event='page_view') views,
   sum(duration_ms) FILTER (WHERE event='page_engagement') active_ms
  FROM e WHERE origin='client' GROUP BY 1
 ), paths AS (
  SELECT page, lag(page) OVER (PARTITION BY session_id ORDER BY occurred_at,id) previous FROM e WHERE event='page_view'
 ), retention AS (
  SELECT n.day, count(*) FILTER (WHERE p.first_seen <= now()-make_interval(days=>n.day+1)) eligible,
   count(*) FILTER (WHERE p.first_seen <= now()-make_interval(days=>n.day+1) AND EXISTS (
    SELECT 1 FROM public.analytics_events a WHERE a.event='page_view'
      AND coalesce(a.user_id::text,a.anon_id)=p.actor
      AND a.created_at >= p.first_seen+make_interval(days=>n.day) AND a.created_at < p.first_seen+make_interval(days=>n.day+1)
      AND (platform_filter IS NULL OR a.platform=platform_filter)
   )) returned
  FROM people p CROSS JOIN (VALUES(1),(7),(30)) n(day)
  WHERE p.first_seen>=now()-make_interval(days=>days) GROUP BY n.day
 )
 SELECT jsonb_build_object(
 'generated_at',now(), 'days',days,
 'overview',(SELECT jsonb_build_object(
   'active_users', count(DISTINCT actor) FILTER(WHERE event='page_view'),
   'dau',count(DISTINCT actor) FILTER(WHERE event='page_view' AND created_at>=now()-interval '1 day'),
   'wau',count(DISTINCT actor) FILTER(WHERE event='page_view' AND created_at>=now()-interval '7 days'),
   'sessions',count(DISTINCT session_id) FILTER(WHERE event='page_view'),
   'page_views',count(*) FILTER(WHERE event='page_view'),
   'api_calls',count(*) FILTER(WHERE event='api_request'),
   'api_failures',count(*) FILTER(WHERE event='api_request' AND coalesce((properties->>'status')::int,0) NOT BETWEEN 200 AND 399),
   'estimated_cost',sum(estimated_cost) FILTER(WHERE event='api_request'),
   'unpriced_calls',count(*) FILTER(WHERE event='api_request' AND estimated_cost IS NULL),
   'errors',count(*) FILTER(WHERE event='client_error'),
   'saves',count(*) FILTER(WHERE event='restaurant_saved'),
   'cache_hits',count(*) FILTER(WHERE event='api_cache_hit')
 ) FROM e),
 'daily',coalesce((SELECT jsonb_agg(x ORDER BY day) FROM (SELECT to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD') AS day, count(DISTINCT actor) FILTER(WHERE event='page_view') users, count(*) FILTER(WHERE event='page_view') views, count(*) FILTER(WHERE event='api_request') calls, sum(estimated_cost) cost FROM e GROUP BY 1) x),'[]'),
 'pages',coalesce((SELECT jsonb_agg(x ORDER BY views DESC) FROM (SELECT page, count(*) FILTER(WHERE event='page_view') views, count(DISTINCT actor) FILTER(WHERE event='page_view') users, coalesce(sum(duration_ms) FILTER(WHERE event='page_engagement'),0) active_ms FROM e WHERE origin='client' GROUP BY page) x),'[]'),
 'features',coalesce((SELECT jsonb_agg(x ORDER BY uses DESC) FROM (SELECT feature, count(*) FILTER(WHERE event='feature_seen') exposures, count(DISTINCT actor) FILTER(WHERE event='feature_seen') exposed_users, count(*) FILTER(WHERE event IN ('feature_used','feature_outcome')) uses, count(DISTINCT actor) FILTER(WHERE event IN ('feature_used','feature_outcome')) users FROM e WHERE feature IS NOT NULL AND event IN ('feature_seen','feature_used','feature_outcome') GROUP BY feature) x),'[]'),
 'restaurants',coalesce((SELECT jsonb_agg(x ORDER BY opens DESC) FROM (SELECT restaurant_id, max(restaurant_name) name, count(*) FILTER(WHERE event='restaurant_returned') returned, count(*) FILTER(WHERE event='restaurant_seen') seen, count(*) FILTER(WHERE event='restaurant_opened') opens, count(DISTINCT actor) FILTER(WHERE event='restaurant_opened') visitors, count(*) FILTER(WHERE event='restaurant_search_selected') searches, count(*) FILTER(WHERE event='restaurant_saved') saves, count(*) FILTER(WHERE event='restaurant_rated') ratings, count(*) FILTER(WHERE event='restaurant_shared') shares, count(*) FILTER(WHERE event='restaurant_outbound') outbound, count(*) FILTER(WHERE event='api_request') api_calls, sum(estimated_cost) cost FROM e WHERE restaurant_id IS NOT NULL GROUP BY restaurant_id ORDER BY CASE restaurant_sort WHEN 'seen' THEN count(*) FILTER(WHERE event='restaurant_seen') WHEN 'returned' THEN count(*) FILTER(WHERE event='restaurant_returned') WHEN 'saves' THEN count(*) FILTER(WHERE event='restaurant_saved') WHEN 'api_calls' THEN count(*) FILTER(WHERE event='api_request') WHEN 'searches' THEN count(*) FILTER(WHERE event='restaurant_search_selected') ELSE count(*) FILTER(WHERE event='restaurant_opened') END DESC LIMIT 250) x),'[]'),
 'apis',coalesce((SELECT jsonb_agg(x ORDER BY calls DESC) FROM (SELECT properties->>'provider' provider, properties->>'endpoint' endpoint, coalesce(properties->>'source',page) source, origin, app_version, count(*) calls, count(*) FILTER(WHERE coalesce((properties->>'status')::int,0) NOT BETWEEN 200 AND 399) failures, round(avg(duration_ms)) avg_ms, percentile_cont(.95) WITHIN GROUP(ORDER BY duration_ms) p95_ms, sum(estimated_cost) cost, count(*) FILTER(WHERE estimated_cost IS NULL) unpriced, max(properties->>'field_mask') field_mask FROM e WHERE event='api_request' GROUP BY 1,2,3,4,5 ORDER BY calls DESC LIMIT 250) x),'[]'),
 'users',coalesce((SELECT jsonb_agg(x ORDER BY last_seen DESC) FROM (SELECT u.*, p.display_name, p.username FROM (SELECT actor, max(user_id::text) user_id, min(created_at) first_seen_in_range, max(created_at) last_seen, count(DISTINCT session_id) FILTER(WHERE event='page_view') sessions, count(*) FILTER(WHERE event='page_view') views, count(*) FILTER(WHERE event='restaurant_saved') saves, count(*) FILTER(WHERE event='api_request') calls, sum(estimated_cost) cost FROM e WHERE origin='client' OR user_id IS NOT NULL GROUP BY actor ORDER BY last_seen DESC LIMIT 200) u LEFT JOIN public.user_profiles p ON p.user_id::text=u.user_id) x),'[]'),
 'paths',coalesce((SELECT jsonb_agg(x ORDER BY transitions DESC) FROM (SELECT previous source, page destination, count(*) transitions FROM paths WHERE previous IS NOT NULL AND previous<>page GROUP BY 1,2 ORDER BY transitions DESC LIMIT 50) x),'[]'),
 'searches',coalesce((SELECT jsonb_agg(x ORDER BY searches DESC) FROM (SELECT coalesce(properties->>'query','[search text disabled]') query, count(*) searches, count(*) FILTER(WHERE (properties->>'result_count')::int=0) empty, round(avg((properties->>'result_count')::int),1) avg_results FROM e WHERE event='search_completed' GROUP BY 1 ORDER BY searches DESC LIMIT 100) x),'[]'),
 'retention',coalesce((SELECT jsonb_agg(r ORDER BY day) FROM retention r),'[]'),
 'outcomes',coalesce((SELECT jsonb_agg(x ORDER BY count DESC) FROM (SELECT event, coalesce(properties->>'stage',properties->>'verdict',properties->>'outcome',properties->>'action','') detail, count(*) count, count(DISTINCT actor) users FROM e WHERE event IN ('onboarding_step','billing_event','ai_feedback','feature_outcome','client_error','restaurant_outbound') GROUP BY 1,2 ORDER BY count DESC LIMIT 100) x),'[]'),
 'coverage',coalesce((SELECT jsonb_agg(x ORDER BY searches DESC) FROM (SELECT coalesce(properties->>'city','unspecified') city, coalesce(properties->>'cuisine','all') cuisine, count(*) searches, count(*) FILTER(WHERE (properties->>'result_count')::int=0) empty FROM e WHERE event='search_completed' GROUP BY 1,2 ORDER BY searches DESC LIMIT 100) x),'[]'),
 'session_quality',(SELECT jsonb_build_object('single_page_sessions',count(*) FILTER(WHERE views=1),'median_active_ms',percentile_cont(.5) WITHIN GROUP(ORDER BY active_ms)) FROM sessions)
 ) INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.analytics_report(integer,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.analytics_report(integer,text,text) TO authenticated;

CREATE FUNCTION public.analytics_user_activity(actor_id text, before_time timestamptz DEFAULT now(), before_id uuid DEFAULT 'ffffffff-ffff-ffff-ffff-ffffffffffff') RETURNS SETOF public.analytics_events
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_app_admin() THEN RAISE EXCEPTION 'Admins only' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT * FROM public.analytics_events a WHERE (a.user_id::text=actor_id OR a.anon_id=actor_id) AND (a.created_at,a.id)<(before_time,before_id) ORDER BY a.created_at DESC,a.id DESC LIMIT 100;
END $$;
REVOKE ALL ON FUNCTION public.analytics_user_activity(text,timestamptz,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.analytics_user_activity(text,timestamptz,uuid) TO authenticated;

-- Service-only maintenance: invoke daily from Supabase Cron or your scheduler.
CREATE FUNCTION public.analytics_prune() RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 DELETE FROM public.analytics_events WHERE created_at < now()-interval '180 days';
$$;
REVOKE ALL ON FUNCTION public.analytics_prune() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.analytics_prune() TO service_role;
NOTIFY pgrst, 'reload schema';
