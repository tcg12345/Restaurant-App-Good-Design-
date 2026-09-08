-- Owner-only exploration reports. No new grants on the underlying event data.
CREATE FUNCTION public.analytics_exploration(days integer DEFAULT 30, platform_filter text DEFAULT NULL, actor_id text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' SET statement_timeout = '15s' AS $$
DECLARE result jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_app_admin() THEN RAISE EXCEPTION 'Admins only' USING ERRCODE='42501'; END IF;
 IF days IS NULL OR days NOT BETWEEN 1 AND 90 THEN RAISE EXCEPTION 'Choose 1 to 90 days'; END IF;
 IF platform_filter IS NOT NULL AND platform_filter NOT IN ('web','ios','server') THEN RAISE EXCEPTION 'Invalid platform'; END IF;
 WITH events AS MATERIALIZED (
  SELECT a.*, coalesce(a.user_id::text,a.anon_id) actor
  FROM public.analytics_events a
  WHERE a.created_at >= now()-make_interval(days=>days) AND a.origin='client'
   AND a.event IN ('page_view','page_engagement') AND a.page NOT IN ('admin','startup')
   AND (platform_filter IS NULL OR a.platform=platform_filter)
 ), numbered AS (
  SELECT e.*, count(*) FILTER(WHERE event='page_view') OVER (
   PARTITION BY actor,session_id,platform ORDER BY occurred_at,id ROWS UNBOUNDED PRECEDING) visit_number
  FROM events e
 ), tagged AS MATERIALIZED (
  SELECT n.*, coalesce(properties->>'visit_id',max(CASE WHEN event='page_view' THEN coalesce(properties->>'visit_id',id::text) END)
   OVER (PARTITION BY actor,session_id,platform,visit_number)) visit_key
  FROM numbered n
 ), times AS (
  SELECT actor,session_id,platform,visit_key,page,sum(duration_ms) active_ms,count(*) segments
  FROM tagged WHERE event='page_engagement' AND duration_ms>0 GROUP BY 1,2,3,4,5
 ), all_visits AS MATERIALIZED (
  SELECT v.id,v.visit_key,v.actor,v.user_id,v.session_id,v.platform,v.page,v.occurred_at,
   coalesce(t.active_ms,0) active_ms,coalesce(t.segments,0) segments
  FROM tagged v LEFT JOIN times t ON t.actor=v.actor AND t.session_id=v.session_id AND t.platform=v.platform AND t.visit_key=v.visit_key AND t.page=v.page
  WHERE v.event='page_view'
 ), visits AS MATERIALIZED (
  SELECT v.*,lag(page) OVER w previous,lead(page) OVER w next,
   row_number() OVER w position,
   row_number() OVER (PARTITION BY actor,session_id,platform ORDER BY occurred_at DESC,id DESC) reverse_position
  FROM all_visits v WHERE actor_id IS NULL OR v.actor=actor_id
  WINDOW w AS (PARTITION BY actor,session_id,platform ORDER BY occurred_at,id)
 ), person_pages AS (
  SELECT page,actor,count(*) views FROM visits GROUP BY 1,2
 ), pages AS (
  SELECT page,count(*) views,count(DISTINCT actor) visitors,sum(active_ms) active_ms,
   count(*) FILTER(WHERE segments>0) timed_visits,
   round(avg(active_ms) FILTER(WHERE segments>0)) avg_active_ms,
   percentile_cont(.5) WITHIN GROUP(ORDER BY active_ms) FILTER(WHERE segments>0) median_active_ms,
   count(*) FILTER(WHERE segments>0 AND active_ms<=10000) brief_visits,
   count(*) FILTER(WHERE segments>0 AND active_ms>=60000) long_visits,
   count(*) FILTER(WHERE position=1) entries,count(*) FILTER(WHERE reverse_position=1) last_stops,
   (SELECT count(*) FROM person_pages p WHERE p.page=v.page AND p.views>1) repeat_visitors
  FROM visits v GROUP BY page
 ), sessions AS MATERIALIZED (
  SELECT actor,session_id,platform,min(occurred_at) started_at,max(occurred_at) last_seen,
   count(*) views,count(DISTINCT page) pages,sum(active_ms) active_ms
  FROM visits GROUP BY 1,2,3
 ), recent AS (
  SELECT * FROM sessions ORDER BY started_at DESC,session_id LIMIT 20
 )
 SELECT jsonb_build_object(
  'generated_at',now(),'days',days,'actor',actor_id,
  'summary',(SELECT jsonb_build_object('visitors',count(DISTINCT actor),'visits',count(*),'active_ms',coalesce(sum(active_ms),0),'pages',count(DISTINCT page),'timed_visits',count(*) FILTER(WHERE segments>0)) FROM visits),
  'session_summary',(SELECT jsonb_build_object('sessions',count(*),'median_pages',percentile_cont(.5) WITHIN GROUP(ORDER BY pages),'median_active_ms',percentile_cont(.5) WITHIN GROUP(ORDER BY active_ms),'single_page_sessions',count(*) FILTER(WHERE pages=1)) FROM sessions),
  'pages',coalesce((SELECT jsonb_agg(p ORDER BY active_ms DESC,page) FROM pages p),'[]'),
  'baseline',coalesce((SELECT jsonb_agg(p) FROM (SELECT page,count(*) views,count(DISTINCT actor) visitors,round(avg(active_ms) FILTER(WHERE segments>0)) avg_active_ms FROM all_visits GROUP BY page) p),'[]'),
  'transitions',coalesce((SELECT jsonb_agg(p ORDER BY transitions DESC,source,destination) FROM (SELECT previous source,page destination,count(*) transitions,count(DISTINCT actor) visitors FROM visits WHERE previous IS NOT NULL AND previous<>page GROUP BY 1,2) p),'[]'),
  'rhythm',coalesce((SELECT jsonb_agg(p ORDER BY weekday,"hour") FROM (SELECT extract(isodow FROM occurred_at AT TIME ZONE 'UTC')::int-1 weekday,extract(hour FROM occurred_at AT TIME ZONE 'UTC')::int AS "hour",count(*) visits FROM visits GROUP BY 1,2) p),'[]'),
  'sessions',coalesce((SELECT jsonb_agg(to_jsonb(r)||jsonb_build_object('steps',coalesce((SELECT jsonb_agg(t ORDER BY occurred_at,id) FROM (SELECT id,page,occurred_at,active_ms,segments FROM visits v WHERE v.actor=r.actor AND v.session_id=r.session_id AND v.platform=r.platform ORDER BY occurred_at,id LIMIT 100) t),'[]'::jsonb)) ORDER BY started_at DESC,session_id) FROM recent r),'[]'),
  'unmatched_segments',(SELECT count(*) FROM tagged e WHERE event='page_engagement' AND duration_ms>0 AND (actor_id IS NULL OR e.actor=actor_id) AND NOT EXISTS(SELECT 1 FROM visits v WHERE v.actor=e.actor AND v.session_id=e.session_id AND v.platform=e.platform AND v.page=e.page AND v.visit_key=e.visit_key))
 ) INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.analytics_exploration(integer,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.analytics_exploration(integer,text,text) TO authenticated;

CREATE FUNCTION public.analytics_exploration_visitors(days integer DEFAULT 30, platform_filter text DEFAULT NULL, search_query text DEFAULT '') RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' SET statement_timeout = '10s' AS $$
DECLARE result jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_app_admin() THEN RAISE EXCEPTION 'Admins only' USING ERRCODE='42501'; END IF;
 IF days IS NULL OR days NOT BETWEEN 1 AND 90 THEN RAISE EXCEPTION 'Choose 1 to 90 days'; END IF;
 WITH people AS (
  SELECT coalesce(user_id::text,anon_id) actor,max(user_id::text) user_id,count(*) views,max(created_at) last_seen
  FROM public.analytics_events WHERE origin='client' AND event='page_view' AND page NOT IN ('admin','startup')
   AND created_at>=now()-make_interval(days=>days) AND (platform_filter IS NULL OR platform=platform_filter) GROUP BY 1
 )
 SELECT coalesce(jsonb_agg(p ORDER BY last_seen DESC,actor),'[]') INTO result FROM (
  SELECT a.*,u.username,u.display_name FROM people a LEFT JOIN public.user_profiles u ON u.user_id::text=a.user_id
  WHERE coalesce(search_query,'')='' OR strpos(lower(concat_ws(' ',a.actor,u.username,u.display_name)),lower(left(search_query,100)))>0
  ORDER BY last_seen DESC,actor LIMIT 50
 ) p;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.analytics_exploration_visitors(integer,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.analytics_exploration_visitors(integer,text,text) TO authenticated;
NOTIFY pgrst,'reload schema';
