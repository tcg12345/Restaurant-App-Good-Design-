-- Shared content is held for review. Personal app data and private messages
-- are never copied wholesale into the moderation inbox.
CREATE SCHEMA IF NOT EXISTS safety_private;
REVOKE ALL ON SCHEMA safety_private FROM PUBLIC;
GRANT USAGE ON SCHEMA safety_private TO anon,authenticated,service_role;
CREATE TABLE public.user_blocks (
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 blocked_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,blocked_user_id), CHECK(user_id<>blocked_user_id)
);
CREATE INDEX user_blocks_target_idx ON public.user_blocks(blocked_user_id,user_id);
ALTER TABLE public.user_blocks ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_blocks ON public.user_blocks FOR SELECT TO authenticated USING(user_id=(SELECT auth.uid()));
GRANT SELECT ON public.user_blocks TO authenticated;
REVOKE ALL ON public.user_blocks FROM anon;
CREATE TABLE public.safety_suspensions (
 user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
 reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.safety_suspensions ENABLE ROW LEVEL SECURITY;
CREATE POLICY admin_suspensions ON public.safety_suspensions TO authenticated USING((SELECT public.is_app_admin())) WITH CHECK((SELECT public.is_app_admin()));
GRANT SELECT ON public.safety_suspensions TO authenticated;
CREATE TABLE public.content_moderation (
 kind text NOT NULL, content_id text NOT NULL, user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 snapshot jsonb NOT NULL, revision uuid NOT NULL DEFAULT gen_random_uuid(),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
 reviewed_by uuid, reviewed_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(kind,content_id)
);
CREATE INDEX content_moderation_queue_idx ON public.content_moderation(status,updated_at);
CREATE INDEX content_moderation_owner_idx ON public.content_moderation(user_id,status);
ALTER TABLE public.content_moderation ENABLE ROW LEVEL SECURITY;
CREATE POLICY moderation_read ON public.content_moderation FOR SELECT TO authenticated USING(user_id=(SELECT auth.uid()) OR (SELECT public.is_app_admin()));
GRANT SELECT ON public.content_moderation TO authenticated;
CREATE TABLE public.content_reports (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), reporter_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 kind text NOT NULL, content_id text NOT NULL, author_id uuid NOT NULL,
 reason text NOT NULL CHECK(reason IN ('harassment','hate','sexual','violence','spam','privacy','other')),
 details text NOT NULL DEFAULT '' CHECK(length(details)<=2000), snapshot jsonb NOT NULL,
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved')),
 resolution text, created_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz,
 UNIQUE(reporter_id,kind,content_id)
);
CREATE INDEX content_reports_inbox_idx ON public.content_reports(status,created_at);
ALTER TABLE public.content_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY report_read ON public.content_reports FOR SELECT TO authenticated USING(reporter_id=(SELECT auth.uid()) OR (SELECT public.is_app_admin()));
GRANT SELECT ON public.content_reports TO authenticated;

CREATE FUNCTION safety_private.blocked(a uuid,b uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.user_blocks WHERE (user_id=a AND blocked_user_id=b) OR (user_id=b AND blocked_user_id=a));
$$;
CREATE FUNCTION public.can_interact_with(target uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT target IS NOT NULL AND NOT safety_private.blocked(auth.uid(),target)
 AND NOT EXISTS(SELECT 1 FROM public.safety_suspensions WHERE user_id=target OR user_id=auth.uid());
$$;
CREATE OR REPLACE FUNCTION public.can_view_user_content(viewer uuid,target uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT target IS NOT NULL AND (viewer=target OR (
 NOT safety_private.blocked(viewer,target) AND NOT EXISTS(SELECT 1 FROM public.safety_suspensions WHERE user_id=target)
 AND (COALESCE((SELECT is_public FROM public.user_profiles WHERE user_id=target),false)
 OR EXISTS(SELECT 1 FROM public.user_friends WHERE user_id=viewer AND friend_id=target AND status='accepted'))));
$$;
CREATE OR REPLACE FUNCTION public.can_view_author(target uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT public.can_view_user_content(auth.uid(),target);
$$;
CREATE FUNCTION safety_private.visible(kind text,content_id text,owner_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT owner_id=auth.uid() OR public.is_app_admin() OR (public.can_interact_with(owner_id)
 AND EXISTS(SELECT 1 FROM public.content_moderation m WHERE m.kind=$1 AND m.content_id=$2 AND m.user_id=$3 AND m.status='approved'));
$$;
-- Whitelist fields instead of copying profile settings, taste data, or credentials.
CREATE FUNCTION safety_private.snapshot(kind text,row_data jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT COALESCE(jsonb_object_agg(key,value),'{}'::jsonb) FROM jsonb_each(row_data)
 WHERE key=ANY(CASE WHEN kind='user_profiles' THEN ARRAY['username','display_name','bio','avatar_url'] ELSE
 ARRAY['name','title','caption','text','body','notes','description','intro','subtitle','cover_photo','entries','photos','steps','ingredients','tags','emoji','restaurantIds','photo','photo_url','url','media_path','media_type','video_path','video_url','mux_playback_id','mux_status','restaurant_data','recipe_data','bg_gradient','audio_label','location_label','cuisine','address','price','recommendation_text','highlight_dishes','restaurant_name','is_public','is_published','visibility','post_id','recipe_id','rating_id','reel_id'] END);
$$;
CREATE FUNCTION safety_private.enqueue(kind text,content_id text,owner_id uuid,content jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 INSERT INTO public.content_moderation(kind,content_id,user_id,snapshot) VALUES(kind,content_id,owner_id,content)
 ON CONFLICT ON CONSTRAINT content_moderation_pkey DO UPDATE SET snapshot=EXCLUDED.snapshot,status='pending',revision=gen_random_uuid(),updated_at=now(),reviewed_by=NULL,reviewed_at=NULL
 WHERE content_moderation.snapshot IS DISTINCT FROM EXCLUDED.snapshot;
END; $$;
CREATE FUNCTION safety_private.capture_content() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j jsonb; owner_id uuid; item_id text;
BEGIN
 j:=CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
 item_id:=CASE WHEN TG_TABLE_NAME='user_profiles' THEN j->>'user_id' ELSE j->>'id' END;
 IF TG_OP='DELETE' THEN DELETE FROM public.content_moderation WHERE kind=TG_TABLE_NAME AND content_id=item_id; RETURN OLD; END IF;
 owner_id:=(j->>'user_id')::uuid;
 IF TG_TABLE_NAME='post_items' THEN SELECT user_id INTO owner_id FROM public.posts WHERE id=(j->>'post_id')::uuid; END IF;
 -- Completely private recipes and draft guides stay private, including from the inbox.
 IF (TG_TABLE_NAME='recipes' AND NOT COALESCE((j->>'is_public')::boolean,false)) OR
 (TG_TABLE_NAME='guides' AND (NOT COALESCE((j->>'is_published')::boolean,false) OR j->>'visibility'<>'public')) THEN
 DELETE FROM public.content_moderation WHERE kind=TG_TABLE_NAME AND content_id=item_id; RETURN NEW;
 END IF;
 PERFORM safety_private.enqueue(TG_TABLE_NAME,item_id,owner_id,safety_private.snapshot(TG_TABLE_NAME,j)); RETURN NEW;
END; $$;
DO $$ DECLARE t text; owner_expr text; BEGIN
 FOREACH t IN ARRAY ARRAY['user_profiles','community_ratings','community_photos','posts','reels','recipes','guides','activity_comments','post_comments','reel_comments','recipe_reviews','recipe_comments','expert_recommendations'] LOOP
 EXECUTE format('CREATE TRIGGER safety_capture AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION safety_private.capture_content()',t);
 owner_expr:=CASE WHEN t='user_profiles' THEN 'user_id::text' ELSE 'id::text' END;
 EXECUTE format('CREATE POLICY safety_read ON public.%I AS RESTRICTIVE FOR SELECT TO anon,authenticated USING(safety_private.visible(%L,%s,user_id))',t,t,owner_expr);
 END LOOP;
END $$;
CREATE TRIGGER safety_capture AFTER INSERT OR UPDATE OR DELETE ON public.post_items FOR EACH ROW EXECUTE FUNCTION safety_private.capture_content();
CREATE POLICY safety_read ON public.post_items AS RESTRICTIVE FOR SELECT TO anon,authenticated USING(
 EXISTS(SELECT 1 FROM public.posts p WHERE p.id=post_id AND safety_private.visible('post_items',post_items.id::text,p.user_id)));

-- Publishing a changed public meal/list requires a fresh review; unrelated app
-- state saves neither expose private data nor invalidate existing approvals.
CREATE FUNCTION safety_private.enqueue_app_data(j jsonb,owner_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r record; item jsonb; items jsonb; k text; seen text[]:=ARRAY[]::text[]; ident text;
BEGIN
 FOREACH k IN ARRAY ARRAY['home_meals','lists','wishlist'] LOOP
 items:=CASE WHEN jsonb_typeof(j->k)='array' THEN j->k ELSE '[]'::jsonb END;
 IF k='home_meals' THEN items:=items || CASE WHEN jsonb_typeof(j->'restaurant_meta'->'__home_meals__')='array' THEN j->'restaurant_meta'->'__home_meals__' ELSE '[]'::jsonb END; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(items) LOOP
 ident:=owner_id::text||':'||COALESCE(item->>'id',item->>'restaurantId');
 IF ident IS NULL OR k||':'||ident=ANY(seen) THEN CONTINUE; END IF;
 seen:=array_append(seen,k||':'||ident);
 IF k='home_meals' AND (NOT COALESCE((item->>'isPublic')::boolean,false) OR COALESCE(j->'restaurant_meta'->'__deleted_meals__','[]'::jsonb) ? (item->>'id')) THEN CONTINUE; END IF;
 PERFORM safety_private.enqueue(k,ident,owner_id,CASE WHEN k='home_meals' THEN item ELSE safety_private.snapshot(k,item) END);
 END LOOP;
 DELETE FROM public.content_moderation WHERE user_id=owner_id AND kind=k AND NOT (kind||':'||content_id=ANY(seen));
 END LOOP;
 FOR r IN SELECT key,value FROM jsonb_each(CASE WHEN jsonb_typeof(j->'restaurant_meta'->'__my_meal_reviews__')='object' THEN j->'restaurant_meta'->'__my_meal_reviews__' ELSE '{}'::jsonb END) LOOP
 IF jsonb_typeof(r.value)='object' THEN PERFORM safety_private.enqueue('meal_reviews',owner_id::text||':'||r.key,owner_id,jsonb_build_object('notes',COALESCE(r.value->>'notes',''),'rating',r.value->'rating')); END IF;
 END LOOP;
END; $$;
CREATE FUNCTION safety_private.capture_app_data() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN PERFORM safety_private.enqueue_app_data(to_jsonb(NEW),NEW.user_id); RETURN NEW; END; $$;
CREATE TRIGGER safety_app_data AFTER INSERT OR UPDATE ON public.user_app_data FOR EACH ROW EXECUTE FUNCTION safety_private.capture_app_data();

CREATE FUNCTION public.set_user_block(target uuid,blocked boolean) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE me uuid:=auth.uid();
BEGIN
 IF me IS NULL OR target IS NULL OR target=me THEN RAISE EXCEPTION 'Choose another account' USING ERRCODE='42501'; END IF;
 IF blocked THEN
 INSERT INTO public.user_blocks(user_id,blocked_user_id) VALUES(me,target) ON CONFLICT DO NOTHING;
 DELETE FROM public.user_friends WHERE (user_id=me AND friend_id=target) OR (user_id=target AND friend_id=me);
 DELETE FROM public.notifications WHERE (user_id=me AND actor_id=target) OR (user_id=target AND actor_id=me);
 ELSE DELETE FROM public.user_blocks WHERE user_id=me AND blocked_user_id=target; END IF;
END; $$;
CREATE FUNCTION safety_private.guard_contact() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j jsonb:=to_jsonb(NEW); a uuid; b uuid; participants uuid[];
BEGIN
 IF EXISTS(SELECT 1 FROM public.safety_suspensions WHERE user_id=auth.uid()) THEN RAISE EXCEPTION 'Community access is suspended. Contact support to appeal.' USING ERRCODE='42501'; END IF;
 IF TG_TABLE_NAME='user_friends' THEN a:=NEW.user_id; b:=NEW.friend_id;
 IF safety_private.blocked(a,b) THEN RAISE EXCEPTION 'This account is unavailable' USING ERRCODE='42501'; END IF;
 ELSIF TG_TABLE_NAME='messages' THEN
 SELECT participant_ids INTO participants FROM public.conversations WHERE id=NEW.conversation_id;
 IF EXISTS(SELECT 1 FROM unnest(participants) p WHERE safety_private.blocked(NEW.sender_id,p)) THEN RAISE EXCEPTION 'Messaging is unavailable for this conversation' USING ERRCODE='42501'; END IF;
 ELSIF TG_TABLE_NAME='conversations' THEN participants:=NEW.participant_ids;
 IF EXISTS(SELECT 1 FROM unnest(participants) x(a_id) CROSS JOIN unnest(participants) y(b_id) WHERE safety_private.blocked(x.a_id,y.b_id)) THEN RAISE EXCEPTION 'These accounts cannot share a conversation' USING ERRCODE='42501'; END IF;
 ELSIF TG_TABLE_NAME='shared_lists' THEN participants:=NEW.member_ids||NEW.owner_id;
 IF EXISTS(SELECT 1 FROM unnest(participants) x(a_id) CROSS JOIN unnest(participants) y(b_id) WHERE safety_private.blocked(x.a_id,y.b_id)) THEN RAISE EXCEPTION 'These accounts cannot share a list' USING ERRCODE='42501'; END IF;
 ELSIF TG_TABLE_NAME='notifications' THEN
 IF safety_private.blocked(NEW.user_id,NEW.actor_id) OR NEW.kind='comment' THEN RETURN NULL; END IF;
 END IF; RETURN NEW;
END; $$;
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['user_friends','messages','conversations','shared_lists','notifications'] LOOP
 EXECUTE format('CREATE TRIGGER safety_contact BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION safety_private.guard_contact()',t);
END LOOP; END $$;
CREATE POLICY safety_read ON public.messages AS RESTRICTIVE FOR SELECT TO authenticated USING(public.can_interact_with(sender_id));
CREATE POLICY safety_read ON public.notifications AS RESTRICTIVE FOR SELECT TO authenticated USING(actor_id IS NULL OR public.can_interact_with(actor_id));
CREATE POLICY safety_read ON public.user_friends AS RESTRICTIVE FOR SELECT TO authenticated USING(public.can_interact_with(user_id) AND public.can_interact_with(friend_id));

CREATE FUNCTION safety_private.report_visible(p_kind text,p_id text) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE allowed boolean; owner_id uuid; item_id text;
BEGIN
 IF p_kind=ANY(ARRAY['user_profiles','community_ratings','community_photos','posts','post_items','reels','recipes','guides','activity_comments','post_comments','reel_comments','recipe_reviews','recipe_comments','expert_recommendations','messages']) THEN
 EXECUTE format('SELECT EXISTS(SELECT 1 FROM public.%I WHERE %I::text=$1)',p_kind,CASE WHEN p_kind='user_profiles' THEN 'user_id' ELSE 'id' END) INTO allowed USING p_id;
 RETURN allowed;
 ELSIF p_kind IN ('home_meals','lists','wishlist','meal_reviews') THEN
 owner_id:=split_part(p_id,':',1)::uuid; item_id:=substr(p_id,38);
 IF p_kind='home_meals' THEN RETURN EXISTS(SELECT 1 FROM jsonb_array_elements(public.get_public_home_meals(owner_id)) m WHERE m->>'id'=item_id);
 ELSIF p_kind='lists' THEN RETURN EXISTS(SELECT 1 FROM jsonb_array_elements(public.get_public_lists(owner_id)) m WHERE m->>'id'=item_id);
 ELSIF p_kind='wishlist' THEN RETURN EXISTS(SELECT 1 FROM jsonb_array_elements(public.get_public_wishlist(owner_id)) m WHERE m->>'restaurantId'=item_id);
 ELSE RETURN EXISTS(SELECT 1 FROM public.get_meal_reviews_meta(ARRAY[item_id],ARRAY[owner_id])); END IF;
 END IF;
 RETURN false;
END; $$;
CREATE FUNCTION safety_private.capture_report() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE item public.content_moderation;
BEGIN
 IF auth.uid() IS NULL OR NEW.reporter_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Sign in required' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::text,17));
 IF (SELECT count(*) FROM public.content_reports WHERE reporter_id=auth.uid() AND created_at>now()-interval '1 hour')>=20 THEN RAISE EXCEPTION 'Please wait before sending more reports'; END IF;
 IF NEW.kind='comments' THEN SELECT kind INTO NEW.kind FROM public.content_moderation WHERE content_id=NEW.content_id AND kind IN ('post_comments','reel_comments','activity_comments','recipe_reviews') LIMIT 1; END IF;
 IF NEW.kind='messages' THEN SELECT sender_id,jsonb_build_object('text',text,'shared_payload',shared_payload) INTO NEW.author_id,NEW.snapshot FROM public.messages WHERE id::text=NEW.content_id;
 ELSE SELECT * INTO item FROM public.content_moderation WHERE kind=NEW.kind AND content_id=NEW.content_id; NEW.author_id:=item.user_id; NEW.snapshot:=item.snapshot; END IF;
 IF NEW.author_id IS NULL OR NEW.author_id=auth.uid() THEN RAISE EXCEPTION 'This content is unavailable to report' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER safety_report BEFORE INSERT ON public.content_reports FOR EACH ROW EXECUTE FUNCTION safety_private.capture_report();
CREATE POLICY report_insert ON public.content_reports FOR INSERT TO authenticated WITH CHECK(reporter_id=(SELECT auth.uid()) AND safety_private.report_visible(kind,content_id));
GRANT INSERT(reporter_id,kind,content_id,reason,details) ON public.content_reports TO authenticated;
CREATE FUNCTION public.report_content(p_kind text,p_id text,p_reason text,p_details text DEFAULT '') RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 INSERT INTO public.content_reports(reporter_id,kind,content_id,reason,details) VALUES(auth.uid(),p_kind,p_id,p_reason,trim(p_details)) ON CONFLICT(reporter_id,kind,content_id) DO NOTHING;
END; $$;
CREATE FUNCTION public.review_content(p_kind text,p_id text,p_revision uuid,p_approve boolean) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT public.is_app_admin() THEN RAISE EXCEPTION 'Administrator required' USING ERRCODE='42501'; END IF;
 UPDATE public.content_moderation SET status=CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,reviewed_by=auth.uid(),reviewed_at=now()
 WHERE kind=p_kind AND content_id=p_id AND revision=p_revision;
 IF NOT FOUND THEN RAISE EXCEPTION 'This content changed. Refresh before reviewing it.'; END IF;
END; $$;
CREATE FUNCTION public.resolve_content_report(p_report uuid,p_action text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.content_reports;
BEGIN
 IF NOT public.is_app_admin() THEN RAISE EXCEPTION 'Administrator required' USING ERRCODE='42501'; END IF;
 IF p_action NOT IN ('dismiss','remove','suspend') THEN RAISE EXCEPTION 'Invalid action'; END IF;
 SELECT * INTO r FROM public.content_reports WHERE id=p_report FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Report unavailable'; END IF;
 IF p_action IN ('remove','suspend') THEN
 UPDATE public.content_moderation SET status='rejected',reviewed_by=auth.uid(),reviewed_at=now() WHERE kind=r.kind AND content_id=r.content_id;
 IF r.kind='messages' THEN DELETE FROM public.messages WHERE id::text=r.content_id; END IF;
 END IF;
 IF p_action='suspend' THEN INSERT INTO public.safety_suspensions(user_id,reason) VALUES(r.author_id,r.reason) ON CONFLICT(user_id) DO UPDATE SET reason=EXCLUDED.reason; END IF;
 UPDATE public.content_reports SET status='resolved',resolution=p_action,resolved_at=now() WHERE id=p_report;
END; $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA safety_private FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION safety_private.visible(text,text,uuid) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION safety_private.report_visible(text,text) TO authenticated;
REVOKE ALL ON FUNCTION public.can_interact_with(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_interact_with(uuid) TO anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.set_user_block(uuid,boolean),public.report_content(text,text,text,text),public.review_content(text,text,uuid,boolean),public.resolve_content_report(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_user_block(uuid,boolean),public.report_content(text,text,text,text),public.review_content(text,text,uuid,boolean),public.resolve_content_report(uuid,text) TO authenticated;
GRANT ALL ON public.user_blocks,public.content_moderation,public.content_reports,public.safety_suspensions TO service_role;

-- Existing content keeps its current visibility. Every subsequent content edit
-- is reviewed anew. Reports can still remove or suspend existing publications.
DO $$ DECLARE t text; r record; j jsonb; owner_id uuid; ident text; BEGIN
 FOREACH t IN ARRAY ARRAY['user_profiles','community_ratings','community_photos','posts','post_items','reels','recipes','guides','activity_comments','post_comments','reel_comments','recipe_reviews','recipe_comments','expert_recommendations'] LOOP
 FOR r IN EXECUTE format('SELECT to_jsonb(t) AS j FROM public.%I t',t) LOOP
 j:=r.j; owner_id:=(j->>'user_id')::uuid; ident:=CASE WHEN t='user_profiles' THEN j->>'user_id' ELSE j->>'id' END;
 IF t='post_items' THEN SELECT user_id INTO owner_id FROM public.posts WHERE id=(j->>'post_id')::uuid; END IF;
 IF (t='recipes' AND NOT COALESCE((j->>'is_public')::boolean,false)) OR (t='guides' AND (NOT COALESCE((j->>'is_published')::boolean,false) OR j->>'visibility'<>'public')) THEN CONTINUE; END IF;
 PERFORM safety_private.enqueue(t,ident,owner_id,safety_private.snapshot(t,j));
 END LOOP; END LOOP;
 FOR r IN SELECT to_jsonb(u) AS j,user_id FROM public.user_app_data u LOOP PERFORM safety_private.enqueue_app_data(r.j,r.user_id); END LOOP;
 UPDATE public.content_moderation SET status='approved';
END $$;

CREATE OR REPLACE FUNCTION public.get_public_wishlist(target uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'restaurantId', w.item->>'restaurantId',
           'name',         COALESCE(w.item->>'name', ''),
           'cuisine',      COALESCE(w.item->>'cuisine', ''),
           'price',        COALESCE(w.item->>'price', ''),
           'address',      COALESCE(w.item->>'address', ''),
           'notes',        COALESCE(w.item->>'notes', '')
         ) ORDER BY w.ord), '[]'::jsonb)
  FROM public.user_app_data u
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(u.wishlist) = 'array' THEN u.wishlist ELSE '[]'::jsonb END
  ) WITH ORDINALITY AS w(item, ord)
  WHERE u.user_id = target
    AND public.can_view_user_content(auth.uid(), target)
    AND safety_private.visible('wishlist',target::text||':'||(w.item->>'restaurantId'),target);
$$;

CREATE OR REPLACE FUNCTION public.get_public_lists(target uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id',            l.item->>'id',
           'name',          COALESCE(l.item->>'name', ''),
           'emoji',         COALESCE(l.item->>'emoji', ''),
           'restaurantIds', CASE WHEN jsonb_typeof(l.item->'restaurantIds') = 'array'
                                 THEN l.item->'restaurantIds' ELSE '[]'::jsonb END
         ) ORDER BY l.ord), '[]'::jsonb)
  FROM public.user_app_data u
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(u.lists) = 'array' THEN u.lists ELSE '[]'::jsonb END
  ) WITH ORDINALITY AS l(item, ord)
  WHERE u.user_id = target
    AND public.can_view_user_content(auth.uid(), target)
    AND safety_private.visible('lists',target::text||':'||(l.item->>'id'),target);
$$;

CREATE OR REPLACE FUNCTION public.public_home_meals_impl(only_users uuid[], exclude_user uuid)
RETURNS TABLE(user_id uuid, meal jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  WITH viewable AS (
    SELECT u.user_id AS uid, to_jsonb(u) AS j
    FROM public.user_app_data u
    WHERE (only_users IS NULL OR u.user_id = ANY(only_users))
      AND (exclude_user IS NULL OR u.user_id <> exclude_user)
      AND public.can_view_user_content(auth.uid(), u.user_id)
  ),
  expanded AS (
    -- src 2 = dedicated home_meals column (may not exist → jsonb null),
    -- src 1 = restaurant_meta.__home_meals__ fallback. Column wins below.
    SELECT v.uid, v.j, s.meal, s.src
    FROM viewable v
    CROSS JOIN LATERAL (
      SELECT m.value AS meal, 1 AS src
      FROM jsonb_array_elements(
        CASE WHEN jsonb_typeof(v.j->'restaurant_meta'->'__home_meals__') = 'array'
             THEN v.j->'restaurant_meta'->'__home_meals__' ELSE '[]'::jsonb END) AS m
      UNION ALL
      SELECT m.value, 2
      FROM jsonb_array_elements(
        CASE WHEN jsonb_typeof(v.j->'home_meals') = 'array'
             THEN v.j->'home_meals' ELSE '[]'::jsonb END) AS m
    ) AS s
  ),
  deduped AS (
    SELECT DISTINCT ON (e.uid, e.meal->>'id') e.uid, e.meal
    FROM expanded e
    WHERE e.meal->>'id' IS NOT NULL
      AND e.meal->'isPublic' = 'true'::jsonb
      -- Deletion tombstones: drop meals the owner removed.
      AND NOT COALESCE(
        e.j->'restaurant_meta'->'__deleted_meals__' @> to_jsonb(e.meal->>'id'),
        false)
    ORDER BY e.uid, e.meal->>'id', e.src DESC
  )
  -- jsonb ordering compares numbers numerically; missing createdAt last.
  SELECT d.uid, d.meal
  FROM deduped d
  WHERE safety_private.visible('home_meals',d.uid::text||':'||(d.meal->>'id'),d.uid)
  ORDER BY d.meal->'createdAt' DESC NULLS LAST;
$$;

CREATE FUNCTION public.my_blocked_accounts() RETURNS TABLE(user_id uuid,display_name text,username text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT b.blocked_user_id,p.display_name,p.username FROM public.user_blocks b JOIN public.user_profiles p ON p.user_id=b.blocked_user_id WHERE b.user_id=auth.uid() ORDER BY b.created_at DESC;
$$;
REVOKE ALL ON FUNCTION public.my_blocked_accounts() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.my_blocked_accounts() TO authenticated;
-- Moderators can inspect the exact queued publication, including its private
-- storage objects. These grants do not expose private app state or messages.
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['user_profiles','community_ratings','community_photos','posts','post_items','reels','recipes','guides','activity_comments','post_comments','reel_comments','recipe_reviews','recipe_comments','expert_recommendations'] LOOP
 EXECUTE format('CREATE POLICY safety_moderator ON public.%I FOR SELECT TO authenticated USING((SELECT public.is_app_admin()))',t);
 END LOOP;
END $$;
-- Uploaded avatars use the same review and block rules as other photos.
DROP POLICY IF EXISTS "Avatar and legacy visit photo reads" ON storage.objects;
CREATE POLICY "Avatar and legacy visit photo reads" ON storage.objects FOR SELECT TO anon,authenticated USING(bucket_id='avatars' AND (
 (SELECT auth.uid())::text=split_part(name,'/',1)
 OR (split_part(name,'/',1)='restaurant-photos' AND media_private.can_read_photo(bucket_id,name))
 OR EXISTS(SELECT 1 FROM public.user_profiles p WHERE media_private.photo_reference_path(p.avatar_url)='avatars/'||objects.name)
));
CREATE POLICY safety_moderator ON storage.objects FOR SELECT TO authenticated USING(bucket_id IN ('avatars','photos','post-media','reels-videos') AND (SELECT public.is_app_admin()));

CREATE POLICY safety_read ON public.shared_lists AS RESTRICTIVE FOR SELECT TO authenticated USING(public.can_interact_with(owner_id) AND NOT EXISTS(SELECT 1 FROM unnest(member_ids) m WHERE NOT public.can_interact_with(m)));
CREATE POLICY safety_read ON public.conversations AS RESTRICTIVE FOR SELECT TO authenticated USING(NOT EXISTS(SELECT 1 FROM unnest(participant_ids) m WHERE NOT public.can_interact_with(m)));
CREATE OR REPLACE FUNCTION public.is_shared_list_member(p_list uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.shared_lists l WHERE l.id=p_list AND auth.uid()=ANY(l.member_ids)
 AND public.can_interact_with(l.owner_id) AND NOT EXISTS(SELECT 1 FROM unnest(l.member_ids) m WHERE NOT public.can_interact_with(m)));
$$;
REVOKE ALL ON FUNCTION public.is_shared_list_member(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.is_shared_list_member(uuid) TO authenticated,service_role;
-- Do not allow an approved upload's bytes to be replaced under the same URL.
-- App uploads already use unique paths. Retrying a thumbnail writes a new
-- object on its first upload and may safely fail if that thumbnail exists.
CREATE POLICY safety_immutable_upload ON storage.objects AS RESTRICTIVE FOR UPDATE TO authenticated
 USING(bucket_id NOT IN ('avatars','photos','post-media','reels-videos'));

CREATE FUNCTION public.safety_push_allowed(p_notification uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.notifications n WHERE n.id=p_notification
 AND NOT safety_private.blocked(n.user_id,n.actor_id)
 AND NOT EXISTS(SELECT 1 FROM public.safety_suspensions WHERE user_id=n.actor_id));
$$;
REVOKE ALL ON FUNCTION public.safety_push_allowed(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.safety_push_allowed(uuid) TO service_role;

ALTER FUNCTION public.group_room_action(uuid,text,jsonb) RENAME TO group_room_action_before_safety;
CREATE FUNCTION public.group_room_action(actor uuid,action text,payload jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE room private.group_rooms;
BEGIN
 IF EXISTS(SELECT 1 FROM public.safety_suspensions WHERE user_id=actor) THEN RAISE EXCEPTION 'Community access is suspended. Contact support to appeal.'; END IF;
 IF action NOT IN ('leave','cancel','list') THEN
 SELECT * INTO room FROM private.group_rooms r WHERE r.id::text=payload->>'id' OR r.code=upper(trim(payload->>'code')) LIMIT 1;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(COALESCE(room.state->'members','{}'::jsonb)) m WHERE safety_private.blocked(actor,m::uuid)) THEN RAISE EXCEPTION 'This group is unavailable because an account is blocked.'; END IF;
 END IF;
 RETURN public.group_room_action_before_safety(actor,action,payload);
END; $$;
REVOKE ALL ON FUNCTION public.group_room_action(uuid,text,jsonb),public.group_room_action_before_safety(uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.group_room_action(uuid,text,jsonb),public.group_room_action_before_safety(uuid,text,jsonb) TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA safety_private TO service_role;

CREATE FUNCTION safety_private.can_view_recipe_target(p_target text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.recipes r WHERE r.id::text=p_target AND (r.is_public OR r.user_id=auth.uid()) AND safety_private.visible('recipes',r.id::text,r.user_id))
 OR EXISTS(SELECT 1 FROM public.public_home_meals_impl(NULL,NULL) m WHERE m.meal->>'id'=p_target);
$$;
REVOKE ALL ON FUNCTION safety_private.can_view_recipe_target(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION safety_private.can_view_recipe_target(text) TO anon,authenticated,service_role;
CREATE POLICY safety_parent_read ON public.recipe_comments AS RESTRICTIVE FOR SELECT TO anon,authenticated USING(user_id=(SELECT auth.uid()) OR safety_private.can_view_recipe_target(target_id));
CREATE POLICY safety_parent_insert ON public.recipe_comments AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK(safety_private.can_view_recipe_target(target_id));
CREATE POLICY safety_parent_read ON public.recipe_comment_likes AS RESTRICTIVE FOR SELECT TO anon,authenticated USING(EXISTS(SELECT 1 FROM public.recipe_comments c WHERE c.id=comment_id));
CREATE POLICY safety_parent_insert ON public.recipe_comment_likes AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK(EXISTS(SELECT 1 FROM public.recipe_comments c WHERE c.id=comment_id));

CREATE OR REPLACE FUNCTION public.get_meal_reviews_meta(meal_ids text[], scan_user_ids uuid[])
RETURNS TABLE(user_id uuid, meal_id text, rating numeric, notes text, updated_at text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT u.user_id,
         r.key,
         CASE WHEN jsonb_typeof(r.value->'rating') = 'number'
              THEN (r.value->>'rating')::numeric ELSE 0 END,
         COALESCE(r.value->>'notes', ''),
         COALESCE(r.value->>'updatedAt', '')
  FROM public.user_app_data u
  CROSS JOIN LATERAL jsonb_each(
    CASE WHEN jsonb_typeof(u.restaurant_meta->'__my_meal_reviews__') = 'object'
         THEN u.restaurant_meta->'__my_meal_reviews__' ELSE '{}'::jsonb END
  ) AS r(key, value)
  WHERE u.user_id = ANY(scan_user_ids)
    AND r.key = ANY(meal_ids)
    AND jsonb_typeof(r.value) = 'object'
    AND safety_private.visible('meal_reviews',u.user_id::text||':'||r.key,u.user_id)
    AND (u.user_id=auth.uid() OR safety_private.can_view_recipe_target(r.key));
$$;

-- Do not inherit a project's broad default table grants. In particular callers
-- cannot supply report status/timestamps or write moderation decisions directly.
REVOKE ALL ON public.user_blocks,public.content_moderation,public.content_reports,public.safety_suspensions FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.user_blocks,public.content_moderation,public.content_reports,public.safety_suspensions TO authenticated;
GRANT INSERT(reporter_id,kind,content_id,reason,details) ON public.content_reports TO authenticated;
