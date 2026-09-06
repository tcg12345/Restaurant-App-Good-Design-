-- Closed rooms leave the visible list; retain their records for the existing
-- weekly allowance and to tell invited participants that the session ended.
-- Preserve all existing authorization and transaction logic.
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
  perform pg_advisory_xact_lock(hashtextextended(actor::text, 76));
  if not (exists(select 1 from public.user_profiles where user_id=actor and plan='pro' and (pro_until is null or pro_until>now())) or exists(select 1 from public.pro_grants where user_id=actor and (expires_at is null or expires_at>now()))) and exists(select 1 from private.group_rooms where host=actor and created_at>now()-interval '7 days') then
   return jsonb_build_object('error','Your free room is available again seven days after your last session.','upgrade',true);
  end if;
  if (select count(*) from private.group_rooms where host=actor and created_at>now()-interval '1 hour')>=10 then raise exception 'Please finish an existing room first.'; end if;
  if not (payload ?& array['location','count','radius']) or coalesce(length(payload->'location'->>'label'),0) not between 1 and 160 or not (payload->'location' ?& array['lat','lng']) or (payload->'location'->>'lat')::float not between -90 and 90 or (payload->'location'->>'lng')::float not between -180 and 180 or (payload->>'count')::int not between 5 and 15 or (payload->>'radius')::int not between 1000 and 30000 then raise exception 'Choose a location and 5–15 places.'; end if;
  m=jsonb_build_object('name',coalesce((select coalesce(nullif(display_name,''),username) from public.user_profiles where user_id=actor),'You'),'ready',false,'preferences','{}'::jsonb,'votes','{}'::jsonb,'vetoUsed',false);
  s=jsonb_build_object('host',actor,'status','lobby','round',1,'location',payload->'location','count',payload->'count','radius',payload->'radius','members',jsonb_build_object(actor::text,m),'deck','[]'::jsonb,'results','[]'::jsonb,'vetoed','[]'::jsonb);
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
  if action='settings' then
   if s->>'status'<>'lobby' then raise exception 'Settings are locked after preparing the shortlist.'; end if;
   if not (payload ?& array['location','count','radius']) or coalesce(length(payload->'location'->>'label'),0) not between 1 and 160 or not (payload->'location' ?& array['lat','lng']) or (payload->'location'->>'lat')::float not between -90 and 90 or (payload->'location'->>'lng')::float not between -180 and 180 or (payload->>'count')::int not between 5 and 15 or (payload->>'radius')::int not between 1000 and 30000 then raise exception 'Choose a location and 5–15 places.'; end if;
   s=s||jsonb_build_object('location',payload->'location','count',payload->'count','radius',payload->'radius');
  elsif action='preferences' then
   if s->>'status'<>'lobby' then raise exception 'Preferences are locked for this round.'; end if;
   if length((payload->'preferences')::text)>3000 then raise exception 'Please shorten your preferences.'; end if;
   s=jsonb_set(s,array['members',actor::text,'preferences'],payload->'preferences');
   s=jsonb_set(s,array['members',actor::text,'ready'],'true');
  elsif action='generate' then
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
    if jsonb_array_length(payload->'deck')<2 or jsonb_array_length(payload->'deck')>(s->>'count')::int then raise exception 'Not enough matching restaurants.'; end if;
    s=s||jsonb_build_object('status','ready','deck',payload->'deck','personalization',payload->'personalization');
    r.model=payload->'model';
   end if;
  elsif action='start' then
   if s->>'status'<>'ready' then raise exception 'Wait for the shortlist to finish.'; end if;
   s=s||'{"status":"swiping"}';
  elsif action='vote' then
   if s->>'status'<>'swiping' then raise exception 'Voting is not open.'; end if;
   v=payload->>'vote'; p=payload->>'place';
   if (payload->>'round')::int<>(s->>'round')::int then raise exception 'This vote belongs to an earlier round.'; end if;
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
   if not exists(select 1 from jsonb_each(s->'members') where (select count(*) from jsonb_each(value->'votes'))<jsonb_array_length(s->'deck')) then
    select coalesce(jsonb_agg(result order by (result->>'score')::numeric desc,(result->>'fit')::numeric desc,result->>'id'),'[]') into out_results from (
     select c.value||jsonb_build_object('score',round(0.6*avg(case when mem.value->'votes'->>(c.value->>'id')='yes' then 100 else 0 end)+0.4*min(case when mem.value->'votes'->>(c.value->>'id')='yes' then 100 else 0 end),1),'likes',count(*) filter(where mem.value->'votes'->>(c.value->>'id')='yes')) result
     from jsonb_array_elements(s->'deck') c cross join jsonb_each(s->'members') mem
     where not s->'vetoed' ? (c.value->>'id') group by c.value
    ) ranked;
    s=s||jsonb_build_object('status','results','results',out_results);
   end if;
  elsif action='tiebreak' then
   if s->>'status'<>'results' or (s->>'round')::int>=2 then raise exception 'No further round is available.'; end if;
   select coalesce(jsonb_agg(value),'[]') into deck from jsonb_array_elements(s->'results') where value->>'score'=s->'results'->0->>'score';
   if jsonb_array_length(deck)<2 then raise exception 'There is no tie to break.'; end if;
   s=s||jsonb_build_object('deck',deck,'round',2,'status','swiping','results','[]'::jsonb);
   for k in select jsonb_object_keys(s->'members') loop s=jsonb_set(s,array['members',k,'votes'],'{}'); end loop;
  elsif action='cancel' then s=s||'{"status":"closed"}';
  elsif action in ('leave','remove') then
   if s->>'status'<>'lobby' then raise exception 'The room has started. You can return to finish your votes.'; end if;
   k=case when action='leave' then actor::text else payload->>'member' end;
   if k=r.host::text then s=s||'{"status":"closed"}'; else s=jsonb_set(s,'{members}',(s->'members')-k); end if;
  elsif action not in ('snapshot','join') then raise exception 'Unknown action.';
  end if;
  if action<>'snapshot' then
   update private.group_rooms set state=s,model=r.model where id=r.id;
   update public.group_room_events set revision=revision+1 where id=r.id;
  end if;
 end if;
 if action='generate' then return s||jsonb_build_object('id',r.id,'code',r.code); end if;
 -- Preferences remain private; peers see readiness and submitted votes only.
 for k in select jsonb_object_keys(s->'members') loop
  if k<>actor::text then s=jsonb_set(s,array['members',k],(s->'members'->k)-'preferences'); end if;
 end loop;
 return (s-'lease'-'leaseUntil')||jsonb_build_object('id',r.id,'code',r.code,'expiresAt',r.expires_at);
end $function$
;
