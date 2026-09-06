-- LOCAL DATABASE ONLY: creates synthetic auth fixtures. All changes roll back.
-- For the linked project use group-pairwise.sql, which creates no auth users.
begin;
do $$
declare a uuid=gen_random_uuid(); b uuid=gen_random_uuid(); outsider uuid=gen_random_uuid(); r jsonb; id jsonb; lease jsonb; p jsonb; failed boolean; v text; who uuid; ranking jsonb; pair jsonb;
begin
 insert into auth.users(id) values(a),(b),(outsider);
 insert into public.user_profiles(user_id,username,display_name,plan) values(a,'gs_'||substr(a::text,1,8),'Host','free'),(b,'gs_'||substr(b::text,1,8),'Friend','free') on conflict(user_id) do update set plan='free';
 p='{"location":{"label":"Test city","lat":40,"lng":-73},"count":5,"radius":5000}';
 r=public.group_room_action(a,'create',p);assert r->>'status'='lobby'; id=r->'id';
 assert (public.group_room_action(a,'create',p)->>'upgrade')::boolean, 'Free quota must be enforced';
 failed=false;begin perform public.group_room_action(outsider,'snapshot',jsonb_build_object('id',id));exception when others then failed=true;end;assert failed,'Outsiders cannot read room';
 r=public.group_room_action(b,'join',jsonb_build_object('code',r->>'code'));
 p=jsonb_build_object('id',id,'preferences','{"cuisines":["Italian"],"prices":[2],"dietary":[],"notes":"private note"}'::jsonb);
 failed=false;begin perform public.group_room_action(b,'settings',jsonb_build_object('id',id,'location','{"label":"New area","lat":40,"lng":-73}'::jsonb,'count',5,'radius',15000));exception when others then failed=true;end;assert failed,'Only host changes settings';
 perform public.group_room_action(a,'settings',jsonb_build_object('id',id,'location','{"label":"New area","lat":40,"lng":-73}'::jsonb,'count',5,'radius',15000));
 perform public.group_room_action(a,'preferences',p);perform public.group_room_action(b,'preferences',p);
 r=public.group_room_action(a,'snapshot',jsonb_build_object('id',id));assert not (r->'members'->b::text ? 'preferences'),'Peer preferences must stay private';
 failed=false;begin perform public.group_room_action(b,'generate',jsonb_build_object('id',id));exception when others then failed=true;end;assert failed,'Only host generates';
 r=public.group_room_action(a,'generate',jsonb_build_object('id',id));lease=r->'lease';
 failed=false;begin perform public.group_room_action(a,'generate',jsonb_build_object('id',id));exception when others then failed=true;end;assert failed,'Concurrent generation must be locked';
 r=public.group_room_action(a,'publish',jsonb_build_object('id',id,'lease',lease,'deck','[{"id":"p1","fit":83},{"id":"p2","fit":90},{"id":"p3","fit":98},{"id":"p4","fit":76},{"id":"p5","fit":60}]'::jsonb,'model','{}'::jsonb));
 perform public.group_room_action(a,'start',jsonb_build_object('id',id));
 perform public.group_room_action(a,'vote',jsonb_build_object('id',id,'place','p3','vote','veto','round',1));
 failed=false;begin perform public.group_room_action(a,'vote',jsonb_build_object('id',id,'place','p4','vote','veto','round',1));exception when others then failed=true;end;assert failed,'Only one veto';
 foreach v in array array['p1','p2','p4'] loop perform public.group_room_action(a,'vote',jsonb_build_object('id',id,'place',v,'vote','yes','round',1));end loop;
 foreach v in array array['p1','p2','p3'] loop perform public.group_room_action(b,'vote',jsonb_build_object('id',id,'place',v,'vote','yes','round',1));end loop;
 r=public.group_room_action(b,'vote',jsonb_build_object('id',id,'place','p4','vote','no','round',1));
 foreach who in array array[a,b] loop
  r=public.group_room_action(who,'vote',jsonb_build_object('id',id,'place','p5','vote','no','round',1));
  assert r->>'status'='swiping','Personal ranking precedes results';
  ranking=r->'members'->who::text->'ranking';
  while not (ranking->>'done')::boolean loop
   pair=jsonb_build_object('id',id,'round',1,'step',ranking->'comparisons','candidate',ranking->'remaining'->0,'against',ranking->'ordered'->(((ranking->>'lo')::int+(ranking->>'hi')::int)/2),'preferred',ranking->'remaining'->0);
   r=public.group_room_action(who,'rank',pair); ranking=r->'members'->who::text->'ranking';
  end loop;
 end loop;
 assert r->>'status'='results';assert jsonb_array_length(r->'results')=4,'Vetoed place excluded';assert r->'results'->0->>'id'='p2','Personal rankings decide the winner';assert (r->'results'->0->>'score')::numeric=80;
 failed=false;begin perform public.group_room_action(a,'rank',jsonb_build_object('id',id,'round',99));exception when others then failed=true;end;assert failed,'Reject stale round rankings';
 perform set_config('request.jwt.claim.sub',outsider::text,true);
 assert not private.can_read_group((id#>>'{}')::uuid),'Realtime must exclude outsiders';
 perform set_config('request.jwt.claim.sub',a::text,true);
 assert private.can_read_group((id#>>'{}')::uuid),'Members may receive realtime';
 assert not has_function_privilege('authenticated','public.group_room_action(uuid,text,jsonb)','EXECUTE'),'Client cannot impersonate actor';
 assert not has_table_privilege('authenticated','private.group_rooms','SELECT'),'Private models inaccessible';
end $$;
rollback;
