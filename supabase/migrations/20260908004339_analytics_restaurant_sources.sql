-- Preserve owner-only access; older events retain unknown provenance.
CREATE OR REPLACE FUNCTION public.analytics_report(days integer DEFAULT 30, platform_filter text DEFAULT NULL, restaurant_sort text DEFAULT 'opens') RETURNS jsonb
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
  FROM e WHERE origin='client' GROUP BY 1 HAVING count(*) FILTER(WHERE event='page_view') > 0
 ), paths AS (
  SELECT page, lag(page) OVER (PARTITION BY actor,session_id ORDER BY occurred_at,id) previous FROM e WHERE event='page_view'
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
 ), restaurant_totals AS (
 SELECT restaurant_id, max(restaurant_name) name, count(*) FILTER(WHERE event='restaurant_returned') returned, count(*) FILTER(WHERE event='restaurant_seen') seen, count(*) FILTER(WHERE event='restaurant_opened') opens, count(DISTINCT actor) FILTER(WHERE event='restaurant_opened') visitors, count(*) FILTER(WHERE event='restaurant_search_selected') searches, count(*) FILTER(WHERE event='restaurant_saved') saves, count(*) FILTER(WHERE event='restaurant_unsaved') unsaves, count(*) FILTER(WHERE event='restaurant_rated') ratings, count(*) FILTER(WHERE event='restaurant_shared') shares, count(*) FILTER(WHERE event='restaurant_outbound') outbound, count(*) FILTER(WHERE event='api_request') api_calls, sum(estimated_cost) cost FROM e WHERE restaurant_id IS NOT NULL GROUP BY restaurant_id
 ), ranked_restaurants AS (
 SELECT *, CASE restaurant_sort WHEN 'seen' THEN seen WHEN 'returned' THEN returned WHEN 'saves' THEN saves WHEN 'api_calls' THEN api_calls WHEN 'searches' THEN searches ELSE opens END sort_value
 FROM restaurant_totals ORDER BY sort_value DESC, restaurant_id LIMIT 250
 ), restaurant_sources AS (
 SELECT restaurant_id,
 CASE WHEN properties->>'data_source' IN ('google_places','own_data','mixed') THEN properties->>'data_source' ELSE 'unknown' END data_source,
 count(*) FILTER(WHERE event='restaurant_search_selected') searches,
 count(*) FILTER(WHERE event='restaurant_returned') returned,
 count(*) FILTER(WHERE event='restaurant_seen') seen,
 count(*) FILTER(WHERE event='restaurant_opened') opens,
 count(*) FILTER(WHERE event='restaurant_saved') saves,
 count(*) FILTER(WHERE event='restaurant_unsaved') unsaves,
 count(*) FILTER(WHERE event='restaurant_rated') ratings,
 count(*) FILTER(WHERE event='restaurant_shared') shares,
 count(*) FILTER(WHERE event='restaurant_outbound') outbound
 FROM e WHERE restaurant_id IN (SELECT restaurant_id FROM ranked_restaurants)
 AND event IN ('restaurant_search_selected','restaurant_returned','restaurant_seen','restaurant_opened','restaurant_saved','restaurant_unsaved','restaurant_rated','restaurant_shared','restaurant_outbound')
 GROUP BY 1,2
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
 'restaurants',coalesce((SELECT jsonb_agg((to_jsonb(r)-'sort_value') || jsonb_build_object('sources', coalesce((SELECT jsonb_agg(to_jsonb(s)-'restaurant_id' ORDER BY data_source) FROM restaurant_sources s WHERE s.restaurant_id=r.restaurant_id),'[]'::jsonb)) ORDER BY sort_value DESC, restaurant_id) FROM ranked_restaurants r),'[]'),
 'apis',coalesce((SELECT jsonb_agg(x ORDER BY calls DESC) FROM (SELECT properties->>'provider' provider, properties->>'endpoint' endpoint, coalesce(properties->>'source',page) source, origin, app_version, coalesce(properties->>'field_mask','') field_mask, count(*) calls, count(*) FILTER(WHERE coalesce((properties->>'status')::int,0) NOT BETWEEN 200 AND 399) failures, round(avg(duration_ms)) avg_ms, percentile_cont(.95) WITHIN GROUP(ORDER BY duration_ms) p95_ms, sum(estimated_cost) cost, count(*) FILTER(WHERE estimated_cost IS NULL) unpriced FROM e WHERE event='api_request' GROUP BY 1,2,3,4,5,6 ORDER BY calls DESC LIMIT 250) x),'[]'),
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

NOTIFY pgrst, 'reload schema';
