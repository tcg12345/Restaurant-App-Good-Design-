-- Custom shortlists use the same locked room state and existing private rankings.
-- No additional exposed tables or client write privileges.
CREATE OR REPLACE FUNCTION private.group_custom_changed(s jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path TO '' AS $$
DECLARE k text;
BEGIN
 FOR k IN SELECT jsonb_object_keys(s->'members') LOOP
  s=jsonb_set(s,ARRAY['members',k,'ready'],'false');
 END LOOP;
 RETURN s||jsonb_build_object('shortlistVersion',coalesce((s->>'shortlistVersion')::int,0)+1,'count',jsonb_array_length(s->'deck'));
END $$;

CREATE OR REPLACE FUNCTION private.group_custom_action(s jsonb, actor uuid, action text, payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path TO '' AS $$
DECLARE host_id text:=s->>'host'; place jsonb; picked text; owner_id text; total int; contributions int;
BEGIN
 IF s->>'source' IS DISTINCT FROM 'custom' OR s->>'status'<>'lobby' THEN RAISE EXCEPTION 'Custom picks can only change before voting starts.'; END IF;
 IF NOT s->'members' ? actor::text THEN RAISE EXCEPTION 'You are not in this room.'; END IF;
 total=jsonb_array_length(s->'deck');
 IF action='custom_add' THEN
  IF actor::text<>host_id AND NOT coalesce((s->>'allowGuestAdds')::boolean,false) THEN RAISE EXCEPTION 'Only the host can add restaurants.'; END IF;
  place=payload->'place'; picked=place->>'id';
  IF jsonb_typeof(place) IS DISTINCT FROM 'object' OR coalesce(length(picked),0) NOT BETWEEN 1 AND 300 OR coalesce(length(place->>'name'),0) NOT BETWEEN 1 AND 300 THEN RAISE EXCEPTION 'Choose a restaurant from search.'; END IF;
  -- Repeated taps and concurrent additions of the same place are idempotent.
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(s->'deck') p WHERE p->>'id'=picked) THEN RETURN s; END IF;
  IF total>=15 THEN RAISE EXCEPTION 'The shortlist is full: 15 restaurants maximum.'; END IF;
  SELECT count(*) INTO contributions FROM jsonb_array_elements(s->'deck') p WHERE p->>'addedBy'=actor::text;
  IF actor::text<>host_id AND contributions>=2 THEN RAISE EXCEPTION 'Each guest can add up to two restaurants. Remove one to choose another.'; END IF;
  -- Authenticated actor attribution and neutral fit cannot be forged by callers.
  place=place||jsonb_build_object('addedBy',actor,'fit',0,'reason','Picked by your group');
  s=jsonb_set(s,'{deck}',(s->'deck')||jsonb_build_array(place));
  RETURN private.group_custom_changed(s);
 ELSIF action='custom_remove' THEN
  picked=payload->>'place';
  SELECT p->>'addedBy' INTO owner_id FROM jsonb_array_elements(s->'deck') p WHERE p->>'id'=picked;
  IF owner_id IS NULL THEN RETURN s; END IF;
  IF actor::text<>host_id AND owner_id<>actor::text THEN RAISE EXCEPTION 'You can only remove your own suggestions.'; END IF;
  s=jsonb_set(s,'{deck}',(SELECT coalesce(jsonb_agg(p),'[]') FROM jsonb_array_elements(s->'deck') p WHERE p->>'id'<>picked));
  RETURN private.group_custom_changed(s);
 ELSIF action='custom_settings' THEN
  IF actor::text<>host_id THEN RAISE EXCEPTION 'Only the host can change who adds places.'; END IF;
  IF jsonb_typeof(payload->'allowGuestAdds') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'Choose who can add places.'; END IF;
  IF s->'allowGuestAdds'=payload->'allowGuestAdds' THEN RETURN s; END IF;
  RETURN private.group_custom_changed(s||jsonb_build_object('allowGuestAdds',payload->'allowGuestAdds'));
 ELSIF action IN ('custom_ready','custom_start') THEN
  IF (payload->>'version')::int IS DISTINCT FROM (s->>'shortlistVersion')::int THEN RAISE EXCEPTION 'The shortlist changed. Review the latest places and try again.'; END IF;
  IF action='custom_ready' THEN RETURN jsonb_set(s,ARRAY['members',actor::text,'ready'],'true'); END IF;
  IF actor::text<>host_id THEN RAISE EXCEPTION 'Only the host can start voting.'; END IF;
  IF total NOT BETWEEN 2 AND 15 THEN RAISE EXCEPTION 'Choose at least two restaurants to compare.'; END IF;
  IF (SELECT count(*) FROM jsonb_each(s->'members'))<2 THEN RAISE EXCEPTION 'Invite at least one friend to start.'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_each(s->'members') m WHERE m.key<>host_id AND NOT coalesce((m.value->>'ready')::boolean,false)) THEN RAISE EXCEPTION 'Wait for everyone to finish their shortlist.'; END IF;
  RETURN s||jsonb_build_object('status','swiping','count',total,'personalization','custom');
 END IF;
 RAISE EXCEPTION 'Unknown custom shortlist action.';
END $$;
REVOKE ALL ON FUNCTION private.group_custom_changed(jsonb),private.group_custom_action(jsonb,uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.group_custom_changed(jsonb),private.group_custom_action(jsonb,uuid,text,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.group_room_action(actor uuid, action text, payload jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare r private.group_rooms; s jsonb; m jsonb; k text; v text; p text; out_results jsonb; deck jsonb; n int; lease text;
begin
 if actor is null then raise exception 'Sign in to join a room.'; end if;
 if action='list' then
  return coalesce((select jsonb_agg(jsonb_build_object('id',id,'code',code,'host',host,'location',state->'location','status',state->'status') order by created_at desc) from private.group_rooms where expires_at>now() and state->>'status'<>'closed' and state->'members' ? actor::text),'[]');
 end if;
 if action in ('create','join') then
  insert into private.group_attempts(user_id,count) values(actor,1) on conflict(user_id) do update set count=case when private.group_attempts.window_start<now()-interval '1 hour' then 1 else private.group_attempts.count+1 end, window_start=case when private.group_attempts.window_start<now()-interval '1 hour' then now() else private.group_attempts.window_start end;
  -- Return an error so the attempt counter commits even on failed code guesses.
  if (select count from private.group_attempts where user_id=actor)>40 then return jsonb_build_object('error','Too many attempts. Try again in an hour.'); end if;
 end if;
 if action='create' then
  if coalesce(payload->>'source','recommendations') not in ('custom','recommendations') or (payload ? 'allowGuestAdds' and jsonb_typeof(payload->'allowGuestAdds')<>'boolean') then raise exception 'Choose a room type and contribution policy.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text, 76));
  if not (exists(select 1 from public.user_profiles where user_id=actor and plan='pro' and (pro_until is null or pro_until>now())) or exists(select 1 from public.pro_grants where user_id=actor and (expires_at is null or expires_at>now()))) and exists(select 1 from private.group_rooms where host=actor and created_at>now()-interval '7 days') then
   return jsonb_build_object('error','Your free room is available again seven days after your last session.','upgrade',true);
  end if;
  if (select count(*) from private.group_rooms where host=actor and created_at>now()-interval '1 hour')>=10 then raise exception 'Please finish an existing room first.'; end if;
  if not (payload ?& array['location','count','radius']) or coalesce(length(payload->'location'->>'label'),0) not between 1 and 160 or not (payload->'location' ?& array['lat','lng']) or (payload->'location'->>'lat')::float not between -90 and 90 or (payload->'location'->>'lng')::float not between -180 and 180 or (payload->>'count')::int not between 5 and 15 or (payload->>'radius')::int not between 1000 and 30000 then raise exception 'Choose a location and 5–15 places.'; end if;
  m=jsonb_build_object('name',coalesce((select coalesce(nullif(display_name,''),username) from public.user_profiles where user_id=actor),'You'),'ready',false,'preferences','{}'::jsonb,'votes','{}'::jsonb,'vetoUsed',false);
  s=jsonb_build_object('rankingVersion',1,'host',actor,'status','lobby','round',1,'location',payload->'location','count',payload->'count','radius',payload->'radius','members',jsonb_build_object(actor::text,m),'deck','[]'::jsonb,'results','[]'::jsonb,'vetoed','[]'::jsonb);
  s=s||jsonb_build_object('source',coalesce(payload->>'source','recommendations'));
  if s->>'source'='custom' then s=s||jsonb_build_object('allowGuestAdds',coalesce((payload->>'allowGuestAdds')::boolean,false),'shortlistVersion',0,'count',0,'personalization','custom'); end if;
  insert into private.group_rooms(code,host,state) values(upper(substr(replace(gen_random_uuid()::text,'-',''),1,8)),actor,s) returning * into r;
  insert into public.group_room_events(id) values(r.id);
 else
  if action='join' then
   select * into r from private.group_rooms where code=upper(regexp_replace(payload->>'code','[^a-zA-Z0-9]','','g')) and expires_at>now() for update;
  else select * into r from private.group_rooms where id=(payload->>'id')::uuid and expires_at>now() for update; end if;
  if r.id is null then return jsonb_build_object('error','This room is unavailable or has expired.'); end if;
  s=r.state;
  if action='join' and not s->'members' ? actor::text then
   if s->>'status'<>'lobby' then raise exception 'This room has already started.'; end if;
   if (select count(*) from jsonb_each(s->'members'))>=20 then raise exception 'This room is full.'; end if;
   s=jsonb_set(s,array['members',actor::text],jsonb_build_object('name',coalesce((select coalesce(nullif(display_name,''),username) from public.user_profiles where user_id=actor),'Friend'),'ready',false,'preferences','{}'::jsonb,'votes','{}'::jsonb,'vetoUsed',false));
  end if;
  if not s->'members' ? actor::text then raise exception 'You are not in this room.'; end if;
  if action in ('generate','publish','failed','start','tiebreak','cancel','remove','settings') and r.host<>actor then raise exception 'Only the host can do that.'; end if;
  if action in ('custom_add','custom_remove','custom_settings','custom_ready') then
   s=private.group_custom_action(s,actor,action,payload);
  elsif action='settings' then
   if s->>'source'='custom' then raise exception 'Use custom shortlist settings for this room.'; end if;
   if s->>'status'<>'lobby' then raise exception 'Settings are locked after preparing the shortlist.'; end if;
   if not (payload ?& array['location','count','radius']) or coalesce(length(payload->'location'->>'label'),0) not between 1 and 160 or not (payload->'location' ?& array['lat','lng']) or (payload->'location'->>'lat')::float not between -90 and 90 or (payload->'location'->>'lng')::float not between -180 and 180 or (payload->>'count')::int not between 5 and 15 or (payload->>'radius')::int not between 1000 and 30000 then raise exception 'Choose a location and 5–15 places.'; end if;
   s=s||jsonb_build_object('location',payload->'location','count',payload->'count','radius',payload->'radius');
  elsif action='preferences' then
   if s->>'source'='custom' then raise exception 'Review the custom shortlist before marking ready.'; end if;
   if s->>'status'<>'lobby' then raise exception 'Preferences are locked for this round.'; end if;
   if length((payload->'preferences')::text)>3000 then raise exception 'Please shorten your preferences.'; end if;
   s=jsonb_set(s,array['members',actor::text,'preferences'],payload->'preferences');
   s=jsonb_set(s,array['members',actor::text,'ready'],'true');
  elsif action='generate' then
   if s->>'source'='custom' then raise exception 'This room uses your own restaurants. Start voting from the shortlist.'; end if;
   if s->>'status'='generating' and (s->>'leaseUntil')::timestamptz>now() then raise exception 'Your shortlist is already being prepared.'; end if;
   if s->>'status' not in ('lobby','generating') then raise exception 'This round has already started.'; end if;
   if (select count(*) from jsonb_each(s->'members'))<2 then raise exception 'Invite at least one friend to start.'; end if;
   if exists(select 1 from jsonb_each(s->'members') where not (value->>'ready')::boolean) then raise exception 'Wait for everyone to set their preferences.'; end if;
   if coalesce((s->>'generationAttempts')::int,0)>=5 then raise exception 'This room has reached its retry limit. Please create a new room later.'; end if;
   s=s||jsonb_build_object('generationAttempts',coalesce((s->>'generationAttempts')::int,0)+1);
   s=s||jsonb_build_object('status','generating','lease',gen_random_uuid()::text,'leaseUntil',now()+interval '150 seconds');
  elsif action in ('publish','failed') then
   if s->>'status'<>'generating' or s->>'lease' is distinct from payload->>'lease' then raise exception 'This shortlist request is no longer active.'; end if;
   if action='failed' then s=s||jsonb_build_object('status','lobby');
   else
    if jsonb_array_length(payload->'deck') IS DISTINCT FROM (s->>'count')::int then raise exception 'Not enough matching restaurants.'; end if;
    s=s||jsonb_build_object('status','ready','deck',payload->'deck','personalization',payload->'personalization');
    r.model=payload->'model';
   end if;
  elsif action='start' then
   if s->>'source'='custom' then s=private.group_custom_action(s,actor,'custom_start',payload);
   else
    if s->>'status'<>'ready' then raise exception 'Wait for the shortlist to finish.'; end if;
    s=s||'{"status":"swiping"}';
   end if;
  elsif action='vote' then
   if s->>'status'<>'swiping' then raise exception 'Voting is not open.'; end if;
   v=payload->>'vote'; p=payload->>'place';
   if (payload->>'round')::int IS DISTINCT FROM (s->>'round')::int then raise exception 'This vote belongs to an earlier round.'; end if;
   if v not in ('yes','no','veto') or not exists(select 1 from jsonb_array_elements(s->'deck') where value->>'id'=p) then raise exception 'Invalid vote.'; end if;
   m=s->'members'->actor::text;
   if m->'votes' ? p then
    if m->'votes'->>p<>v then raise exception 'Your vote was already recorded.'; end if;
   else
    if v='veto' and (m->>'vetoUsed')::boolean then raise exception 'You have used your veto.'; end if;
    s=jsonb_set(s,array['members',actor::text,'votes',p],to_jsonb(v));
    if v='veto' then
     s=jsonb_set(s,array['members',actor::text,'vetoUsed'],'true');
     s=jsonb_set(s,'{vetoed}',(s->'vetoed')||to_jsonb(p));
    end if;
   end if;
   s=private.group_rank_advance(s);
  elsif action='rank' then
   if s->>'status' not in ('swiping','results') or (payload->>'round')::int IS DISTINCT FROM (s->>'round')::int then raise exception 'This comparison is no longer active.'; end if;
   s=private.group_rank_advance(s);
   m=private.group_rank_choose(s->'members'->actor::text->'ranking',payload);
   s=jsonb_set(s,array['members',actor::text,'ranking'],m);
   s=private.group_rank_advance(s);
  elsif action='tiebreak' then
   raise exception 'Rank your liked places after swiping. Results are decided automatically.';
  elsif action='cancel' then s=s||'{"status":"closed"}';
  elsif action in ('leave','remove') then
   if s->>'status'<>'lobby' then raise exception 'The room has started. You can return to finish your votes.'; end if;
   k=case when action='leave' then actor::text else payload->>'member' end;
   if k=r.host::text then s=s||'{"status":"closed"}'; else
    s=jsonb_set(s,'{members}',(s->'members')-k);
    if s->>'source'='custom' then
     s=jsonb_set(s,'{deck}',(select coalesce(jsonb_agg(entry),'[]') from jsonb_array_elements(s->'deck') entry where entry->>'addedBy' is distinct from k));
     s=private.group_custom_changed(s);
    end if;
   end if;
  elsif action not in ('snapshot','join') then raise exception 'Unknown action.';
  end if;
  if action='snapshot' then s=private.group_rank_advance(s); end if;
  if action<>'snapshot' or s IS DISTINCT FROM r.state then
   update private.group_rooms set state=s,model=r.model where id=r.id;
   update public.group_room_events set revision=revision+1 where id=r.id;
  end if;
 end if;
 if action='generate' then return s||jsonb_build_object('id',r.id,'code',r.code); end if;
 -- Preferences remain private; peers see readiness and submitted votes only.
 for k in select jsonb_object_keys(s->'members') loop
  if k<>actor::text then s=jsonb_set(s,array['members',k],(s->'members'->k)-'preferences'-'ranking'||case when s->'members'->k ? 'ranking' then jsonb_build_object('ranking',jsonb_build_object('done',s->'members'->k->'ranking'->'done')) else '{}'::jsonb end); end if;
 end loop;
 return (s-'lease'-'leaseUntil')||jsonb_build_object('id',r.id,'code',r.code,'expiresAt',r.expires_at);
end $function$
;

REVOKE ALL ON FUNCTION public.group_room_action(uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.group_room_action(uuid,text,jsonb) TO service_role;
