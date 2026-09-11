-- These legacy tables/readers have no current application or Edge callers.
-- Preserve data, triggers and trusted server access; close their stale API grants.
DO $$ DECLARE r record; col record; BEGIN
  FOR r IN SELECT c.oid,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=ANY(ARRAY['profiles','friends','friend_requests','restaurants','user_reviews','restaurant_lists','restaurant_list_items','friend_profile_cache','friend_activity_cache','restaurant_shares','itineraries','trips','place_ratings','settings','review_helpfulness','expert_applications','user_roles','reservations','restaurant_staff_assignments','chat_rooms','chat_room_participants','profiles_public_search'])
  LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC,anon,authenticated',r.relname);
    -- Table-level REVOKE alone does not remove independently granted columns.
    FOR col IN SELECT attname FROM pg_attribute WHERE attrelid=r.oid AND attnum>0 AND NOT attisdropped LOOP
      EXECUTE format('REVOKE SELECT(%I),INSERT(%I),UPDATE(%I),REFERENCES(%I) ON public.%I FROM PUBLIC,anon,authenticated',col.attname,col.attname,col.attname,col.attname,r.relname);
    END LOOP;
  END LOOP;
  FOR r IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.prokind='f' AND p.proname=ANY(ARRAY['accept_friend_request','get_discoverable_profiles','get_expert_rating_stats','get_expert_reviews_for_place','get_user_score','get_user_stats','get_or_create_dm_room','search_profiles_safely','is_restaurant_staff_for_reservation','is_restaurant_staff_for_specific_restaurant','user_participates_in_room'])
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',r.signature);
  END LOOP;
END $$;

-- Accept/decline is the only supported client update to a follow request.
REVOKE UPDATE ON public.user_friends FROM PUBLIC,anon,authenticated;
REVOKE UPDATE(id,user_id,friend_id,created_at,status) ON public.user_friends FROM PUBLIC,anon,authenticated;
GRANT UPDATE(status) ON public.user_friends TO authenticated;

DROP POLICY IF EXISTS "Visible parent select" ON public.activity_comments;
CREATE POLICY "Visible parent select" ON public.activity_comments AS RESTRICTIVE FOR SELECT TO anon,authenticated USING (EXISTS (SELECT 1 FROM public.community_ratings p WHERE p.id=activity_comments.rating_id));
DROP POLICY IF EXISTS "Visible parent insert" ON public.activity_comments;
CREATE POLICY "Visible parent insert" ON public.activity_comments AS RESTRICTIVE FOR INSERT TO anon,authenticated WITH CHECK (EXISTS (SELECT 1 FROM public.community_ratings p WHERE p.id=activity_comments.rating_id));
DROP POLICY IF EXISTS "Visible parent update" ON public.activity_comments;
CREATE POLICY "Visible parent update" ON public.activity_comments AS RESTRICTIVE FOR UPDATE TO anon,authenticated USING (EXISTS (SELECT 1 FROM public.community_ratings p WHERE p.id=activity_comments.rating_id)) WITH CHECK (EXISTS (SELECT 1 FROM public.community_ratings p WHERE p.id=activity_comments.rating_id));
DROP POLICY IF EXISTS "Visible parent select" ON public.activity_likes;
CREATE POLICY "Visible parent select" ON public.activity_likes AS RESTRICTIVE FOR SELECT TO anon,authenticated USING (EXISTS (SELECT 1 FROM public.community_ratings p WHERE p.id=activity_likes.rating_id));
DROP POLICY IF EXISTS "Visible parent insert" ON public.activity_likes;
CREATE POLICY "Visible parent insert" ON public.activity_likes AS RESTRICTIVE FOR INSERT TO anon,authenticated WITH CHECK (EXISTS (SELECT 1 FROM public.community_ratings p WHERE p.id=activity_likes.rating_id));
DROP POLICY IF EXISTS "Visible parent update" ON public.activity_likes;
CREATE POLICY "Visible parent update" ON public.activity_likes AS RESTRICTIVE FOR UPDATE TO anon,authenticated USING (EXISTS (SELECT 1 FROM public.community_ratings p WHERE p.id=activity_likes.rating_id)) WITH CHECK (EXISTS (SELECT 1 FROM public.community_ratings p WHERE p.id=activity_likes.rating_id));
DROP POLICY IF EXISTS "Visible parent select" ON public.activity_comment_likes;
CREATE POLICY "Visible parent select" ON public.activity_comment_likes AS RESTRICTIVE FOR SELECT TO anon,authenticated USING (EXISTS (SELECT 1 FROM public.activity_comments p WHERE p.id=activity_comment_likes.comment_id));
DROP POLICY IF EXISTS "Visible parent insert" ON public.activity_comment_likes;
CREATE POLICY "Visible parent insert" ON public.activity_comment_likes AS RESTRICTIVE FOR INSERT TO anon,authenticated WITH CHECK (EXISTS (SELECT 1 FROM public.activity_comments p WHERE p.id=activity_comment_likes.comment_id));
DROP POLICY IF EXISTS "Visible parent update" ON public.activity_comment_likes;
CREATE POLICY "Visible parent update" ON public.activity_comment_likes AS RESTRICTIVE FOR UPDATE TO anon,authenticated USING (EXISTS (SELECT 1 FROM public.activity_comments p WHERE p.id=activity_comment_likes.comment_id)) WITH CHECK (EXISTS (SELECT 1 FROM public.activity_comments p WHERE p.id=activity_comment_likes.comment_id));
DROP POLICY IF EXISTS "Visible parent select" ON public.post_comments;
CREATE POLICY "Visible parent select" ON public.post_comments AS RESTRICTIVE FOR SELECT TO anon,authenticated USING (EXISTS (SELECT 1 FROM public.posts p WHERE p.id=post_comments.post_id));
DROP POLICY IF EXISTS "Visible parent insert" ON public.post_comments;
CREATE POLICY "Visible parent insert" ON public.post_comments AS RESTRICTIVE FOR INSERT TO anon,authenticated WITH CHECK (EXISTS (SELECT 1 FROM public.posts p WHERE p.id=post_comments.post_id));
DROP POLICY IF EXISTS "Visible parent update" ON public.post_comments;
CREATE POLICY "Visible parent update" ON public.post_comments AS RESTRICTIVE FOR UPDATE TO anon,authenticated USING (EXISTS (SELECT 1 FROM public.posts p WHERE p.id=post_comments.post_id)) WITH CHECK (EXISTS (SELECT 1 FROM public.posts p WHERE p.id=post_comments.post_id));
DROP POLICY IF EXISTS "Visible parent select" ON public.post_likes;
CREATE POLICY "Visible parent select" ON public.post_likes AS RESTRICTIVE FOR SELECT TO anon,authenticated USING (EXISTS (SELECT 1 FROM public.posts p WHERE p.id=post_likes.post_id));
DROP POLICY IF EXISTS "Visible parent insert" ON public.post_likes;
CREATE POLICY "Visible parent insert" ON public.post_likes AS RESTRICTIVE FOR INSERT TO anon,authenticated WITH CHECK (EXISTS (SELECT 1 FROM public.posts p WHERE p.id=post_likes.post_id));
DROP POLICY IF EXISTS "Visible parent update" ON public.post_likes;
CREATE POLICY "Visible parent update" ON public.post_likes AS RESTRICTIVE FOR UPDATE TO anon,authenticated USING (EXISTS (SELECT 1 FROM public.posts p WHERE p.id=post_likes.post_id)) WITH CHECK (EXISTS (SELECT 1 FROM public.posts p WHERE p.id=post_likes.post_id));
DROP POLICY IF EXISTS "Visible parent select" ON public.post_saves;
CREATE POLICY "Visible parent select" ON public.post_saves AS RESTRICTIVE FOR SELECT TO anon,authenticated USING (EXISTS (SELECT 1 FROM public.posts p WHERE p.id=post_saves.post_id));
DROP POLICY IF EXISTS "Visible parent insert" ON public.post_saves;
CREATE POLICY "Visible parent insert" ON public.post_saves AS RESTRICTIVE FOR INSERT TO anon,authenticated WITH CHECK (EXISTS (SELECT 1 FROM public.posts p WHERE p.id=post_saves.post_id));
DROP POLICY IF EXISTS "Visible parent update" ON public.post_saves;
CREATE POLICY "Visible parent update" ON public.post_saves AS RESTRICTIVE FOR UPDATE TO anon,authenticated USING (EXISTS (SELECT 1 FROM public.posts p WHERE p.id=post_saves.post_id)) WITH CHECK (EXISTS (SELECT 1 FROM public.posts p WHERE p.id=post_saves.post_id));
DROP POLICY IF EXISTS "Visible parent select" ON public.reel_comments;
CREATE POLICY "Visible parent select" ON public.reel_comments AS RESTRICTIVE FOR SELECT TO anon,authenticated USING (EXISTS (SELECT 1 FROM public.reels p WHERE p.id=reel_comments.reel_id));
DROP POLICY IF EXISTS "Visible parent insert" ON public.reel_comments;
CREATE POLICY "Visible parent insert" ON public.reel_comments AS RESTRICTIVE FOR INSERT TO anon,authenticated WITH CHECK (EXISTS (SELECT 1 FROM public.reels p WHERE p.id=reel_comments.reel_id));
DROP POLICY IF EXISTS "Visible parent update" ON public.reel_comments;
CREATE POLICY "Visible parent update" ON public.reel_comments AS RESTRICTIVE FOR UPDATE TO anon,authenticated USING (EXISTS (SELECT 1 FROM public.reels p WHERE p.id=reel_comments.reel_id)) WITH CHECK (EXISTS (SELECT 1 FROM public.reels p WHERE p.id=reel_comments.reel_id));
DROP POLICY IF EXISTS "Visible parent select" ON public.reel_likes;
CREATE POLICY "Visible parent select" ON public.reel_likes AS RESTRICTIVE FOR SELECT TO anon,authenticated USING (EXISTS (SELECT 1 FROM public.reels p WHERE p.id=reel_likes.reel_id));
DROP POLICY IF EXISTS "Visible parent insert" ON public.reel_likes;
CREATE POLICY "Visible parent insert" ON public.reel_likes AS RESTRICTIVE FOR INSERT TO anon,authenticated WITH CHECK (EXISTS (SELECT 1 FROM public.reels p WHERE p.id=reel_likes.reel_id));
DROP POLICY IF EXISTS "Visible parent update" ON public.reel_likes;
CREATE POLICY "Visible parent update" ON public.reel_likes AS RESTRICTIVE FOR UPDATE TO anon,authenticated USING (EXISTS (SELECT 1 FROM public.reels p WHERE p.id=reel_likes.reel_id)) WITH CHECK (EXISTS (SELECT 1 FROM public.reels p WHERE p.id=reel_likes.reel_id));
DROP POLICY IF EXISTS "Visible parent select" ON public.reel_saves;
CREATE POLICY "Visible parent select" ON public.reel_saves AS RESTRICTIVE FOR SELECT TO anon,authenticated USING (EXISTS (SELECT 1 FROM public.reels p WHERE p.id=reel_saves.reel_id));
DROP POLICY IF EXISTS "Visible parent insert" ON public.reel_saves;
CREATE POLICY "Visible parent insert" ON public.reel_saves AS RESTRICTIVE FOR INSERT TO anon,authenticated WITH CHECK (EXISTS (SELECT 1 FROM public.reels p WHERE p.id=reel_saves.reel_id));
DROP POLICY IF EXISTS "Visible parent update" ON public.reel_saves;
CREATE POLICY "Visible parent update" ON public.reel_saves AS RESTRICTIVE FOR UPDATE TO anon,authenticated USING (EXISTS (SELECT 1 FROM public.reels p WHERE p.id=reel_saves.reel_id)) WITH CHECK (EXISTS (SELECT 1 FROM public.reels p WHERE p.id=reel_saves.reel_id));

CREATE OR REPLACE FUNCTION public.get_expert_stats(user_ids uuid[])
 RETURNS TABLE(user_id uuid, rating_count bigint, follower_count bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    u.uid AS user_id,
    (SELECT count(*) FROM public.community_ratings r
      WHERE r.user_id = u.uid) AS rating_count,
    (SELECT count(*) FROM public.user_friends f
      WHERE f.friend_id = u.uid AND f.status = 'accepted') AS follower_count
  FROM unnest(user_ids) AS u(uid)
  WHERE public.can_view_author(u.uid);
$function$
;

CREATE OR REPLACE FUNCTION public.get_social_suggestions(p_limit integer DEFAULT 60)
 RETURNS TABLE(user_id uuid, mutual_count integer, follows_you boolean, co_rated_count integer, co_rated_agreement integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with me as (select auth.uid() as id),
  -- Everyone the caller already follows or has asked to follow. Both are
  -- excluded from suggestions: a "Follow" button on either reads as
  -- broken. (Matches getSuggestedProfiles' own exclusions.)
  my_edges as (
    select f.friend_id as id
    from public.user_friends f, me
    where f.user_id = me.id
  ),
  my_follows as (
    select f.friend_id as id
    from public.user_friends f, me
    where f.user_id = me.id and f.status = 'accepted'
  ),
  -- Candidate pool, graph-driven rather than arbitrary:
  --   friends-of-friends, plus anyone who already follows me.
  friends_of_friends as (
    select f2.friend_id as id, count(*)::integer as mutuals
    from my_follows mf
    join public.user_friends f2
      on f2.user_id = mf.id and f2.status = 'accepted'
    group by f2.friend_id
  ),
  my_followers as (
    select f.user_id as id
    from public.user_friends f, me
    where f.friend_id = me.id and f.status = 'accepted'
  ),
  candidates as (
    select id from friends_of_friends
    union
    select id from my_followers
  ),
  -- Co-rating overlap. Bounded by the caller's own rating count, so this
  -- costs nothing for a new account and stays proportional for a heavy one.
  my_ratings as (
    select r.restaurant_id, r.score
    from public.community_ratings r, me
    where r.user_id = me.id
  ),
  co_rated as (
    select r.user_id as id,
           count(*)::integer as n,
           count(*) filter (where abs(r.score - mine.score) <= 1.5)::integer as agree
    from public.community_ratings r
    join my_ratings mine on mine.restaurant_id = r.restaurant_id
    join candidates c on c.id = r.user_id
    where public.can_view_author(r.user_id)
    group by r.user_id
  )
  select
    c.id,
    coalesce(fof.mutuals, 0),
    exists (select 1 from my_followers mf where mf.id = c.id),
    coalesce(cr.n, 0),
    coalesce(cr.agree, 0)
  from candidates c
  left join friends_of_friends fof on fof.id = c.id
  left join co_rated cr on cr.id = c.id
  cross join me
  where c.id is not null
    and c.id <> me.id
    and not exists (select 1 from my_edges e where e.id = c.id)
    -- Private accounts can still be suggested (a request is the point),
    -- but a profile row must exist or there is nothing to render.
    and exists (select 1 from public.user_profiles p where p.user_id = c.id)
  -- A cheap pre-sort so the LIMIT keeps the most promising rows; the
  -- real weighted blend happens client-side in lib/suggestions.ts, which
  -- also folds in contacts and taste.
  order by coalesce(fof.mutuals, 0) desc, coalesce(cr.agree, 0) desc, c.id
  limit greatest(0, least(p_limit, 200));
$function$
;

CREATE OR REPLACE FUNCTION public.consume_ai_quota(p_endpoint text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_user UUID := auth.uid();
  v_plan TEXT;
  v_now TIMESTAMPTZ := now();
  r RECORD;
  v_count INTEGER;
  v_start TIMESTAMPTZ;
  v_remaining INTEGER := NULL;
  v_resets TIMESTAMPTZ := NULL;
  v_any BOOLEAN := false;
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('allowed', false, 'plan', 'free', 'pro_only', false, 'remaining', 0, 'resets_at', NULL);
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_user::text || ':' || p_endpoint, 0));
  v_plan := public.effective_plan();

  DELETE FROM public.ai_usage
   WHERE user_id = v_user AND endpoint = p_endpoint AND window_start < v_now - INTERVAL '35 days';

  FOR r IN SELECT window_kind, max_count FROM public.plan_limits WHERE plan = v_plan AND endpoint = p_endpoint LOOP
    v_any := true;
    v_start := public.ai_window_start(r.window_kind, v_now);
    SELECT request_count INTO v_count FROM public.ai_usage
     WHERE user_id = v_user AND endpoint = p_endpoint AND window_kind = r.window_kind AND window_start = v_start;
    v_count := COALESCE(v_count, 0);
    IF v_count >= r.max_count THEN
      RETURN jsonb_build_object(
        'allowed', false, 'plan', v_plan, 'pro_only', r.max_count = 0,
        'remaining', 0, 'resets_at', public.ai_window_end(r.window_kind, v_start));
    END IF;
    IF v_remaining IS NULL OR (r.max_count - v_count - 1) < v_remaining THEN
      v_remaining := r.max_count - v_count - 1;
      v_resets := public.ai_window_end(r.window_kind, v_start);
    END IF;
  END LOOP;

  IF v_any THEN
    FOR r IN SELECT window_kind FROM public.plan_limits WHERE plan = v_plan AND endpoint = p_endpoint LOOP
      v_start := public.ai_window_start(r.window_kind, v_now);
      INSERT INTO public.ai_usage AS u (user_id, endpoint, window_kind, window_start, request_count)
      VALUES (v_user, p_endpoint, r.window_kind, v_start, 1)
      ON CONFLICT (user_id, endpoint, window_kind, window_start)
      DO UPDATE SET request_count = u.request_count + 1;
    END LOOP;
  END IF;

  RETURN jsonb_build_object('allowed', true, 'plan', v_plan, 'pro_only', false, 'remaining', v_remaining, 'resets_at', v_resets);
END;
$function$
;
