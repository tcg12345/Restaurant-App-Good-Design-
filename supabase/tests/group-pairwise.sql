-- Run after the migration. All fixtures roll back; no real sessions or auth users are created.
BEGIN;
DO $$
DECLARE s jsonb; r jsonb; p jsonb; ids text[]:=ARRAY['a','b','c']; i int; j int; pref text; before jsonb;
BEGIN
 s='{"status":"swiping","deck":[{"id":"a","fit":90},{"id":"b","fit":80},{"id":"c","fit":70}],"vetoed":[],"members":{"alice":{"votes":{"a":"yes","b":"yes","c":"yes"}},"bob":{"votes":{"a":"yes","b":"no","c":"yes"}}}}';
 s=private.group_rank_advance(s);
 IF s->>'status'<>'swiping' OR jsonb_array_length(s->'members'->'alice'->'ranking'->'remaining')<>2 THEN RAISE EXCEPTION 'Must enter personal ranking before results'; END IF;
 -- Alice wants c > b > a; Bob wants a > c (b is a pass).
 FOREACH pref IN ARRAY ARRAY['alice','bob'] LOOP
  r=s->'members'->pref->'ranking';
  WHILE NOT (r->>'done')::boolean LOOP
   p=jsonb_build_object('candidate',r->'remaining'->0,'against',r->'ordered'->(((r->>'lo')::int+(r->>'hi')::int)/2),'step',r->'comparisons');
   i=array_position(ids,p->>'candidate'); j=array_position(ids,p->>'against');
   p=p||jsonb_build_object('preferred',CASE WHEN (pref='alice' AND i>j) OR (pref='bob' AND i<j) THEN p->>'candidate' ELSE p->>'against' END);
   r=private.group_rank_choose(r,p);
   IF private.group_rank_choose(r,p)<>r THEN RAISE EXCEPTION 'Retry was not idempotent'; END IF;
  END LOOP;
  s=jsonb_set(s,ARRAY['members',pref,'ranking'],r);
  s=private.group_rank_advance(s);
  IF pref='alice' AND s->>'status'<>'swiping' THEN RAISE EXCEPTION 'Must wait for other personal ranking'; END IF;
 END LOOP;
 IF s->'members'->'alice'->'ranking'->'ordered'<>'["c","b","a"]'::jsonb OR s->'members'->'bob'->'ranking'->'ordered'<>'["a","c"]'::jsonb THEN RAISE EXCEPTION 'Pairwise order incorrect'; END IF;
 IF s->>'status'<>'results' OR (s->'results'->0->>'score')::numeric<>72 OR s->'results'->0->>'id'<>'a' OR (s->'results'->2->>'score')::numeric<>24 THEN RAISE EXCEPTION 'Wrong 60/40 rank aggregation: %',s; END IF;
 -- Zero/one like skips comparisons; veto always excludes.
 s='{"status":"swiping","deck":[{"id":"a","fit":90},{"id":"b","fit":80}],"vetoed":["a"],"members":{"alice":{"votes":{"a":"yes","b":"no"}},"bob":{"votes":{"a":"veto","b":"no"}}}}';
 s=private.group_rank_advance(s);
 IF s->>'status'<>'results' OR jsonb_array_length(s->'results')<>1 OR s->'results'->0->>'id'<>'b' OR (s->'results'->0->>'score')::numeric<>0 THEN RAISE EXCEPTION 'Veto/pass/skip broken'; END IF;
 -- Invalid comparisons cannot inject a rank or replay an old different choice.
 r='{"ordered":["a"],"remaining":["b"],"lo":0,"hi":1,"comparisons":0,"done":false}';
 BEGIN
  PERFORM private.group_rank_choose(r,'{"candidate":"b","against":"a","preferred":"intruder","step":0}');
  RAISE EXCEPTION 'Invalid choice accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='Invalid choice accepted' THEN RAISE; END IF; END;
 BEGIN
  PERFORM private.group_rank_choose(r,'{"candidate":"b","against":"a","preferred":"a","step":99}');
  RAISE EXCEPTION 'Stale step accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='Stale step accepted' THEN RAISE; END IF; END;
END $$;
DO $$
DECLARE people uuid[]; host_id uuid; guest_id uuid; rid uuid:=gen_random_uuid(); s jsonb; result jsonb; a uuid; n int; pair jsonb; rank jsonb;
BEGIN
 SELECT array_agg(id) INTO people FROM (SELECT id FROM auth.users ORDER BY id LIMIT 2) u;
 IF coalesce(array_length(people,1),0)<2 THEN RAISE EXCEPTION 'Requires two existing IDs for rollback fixtures'; END IF;
 host_id=people[1]; guest_id=people[2];
 s=jsonb_build_object('host',host_id,'status','swiping','round',1,'count',5,'radius',5000,'location','{"label":"QA","lat":40.7,"lng":-74}'::jsonb,'deck','[{"id":"a","fit":90},{"id":"b","fit":80}]'::jsonb,'results','[]'::jsonb,'vetoed','[]'::jsonb,'members',jsonb_build_object(host_id::text,'{"name":"Host","ready":true,"votes":{},"vetoUsed":false,"preferences":{"notes":"private"}}'::jsonb,guest_id::text,'{"name":"Guest","ready":true,"votes":{},"vetoUsed":false,"preferences":{"notes":"private"}}'::jsonb));
 INSERT INTO private.group_rooms(id,code,host,state) VALUES(rid,upper(substr(replace(rid::text,'-',''),1,8)),host_id,s);
 INSERT INTO public.group_room_events(id) VALUES(rid);
 FOREACH a IN ARRAY people LOOP
  PERFORM public.group_room_action(a,'vote',jsonb_build_object('id',rid,'round',1,'place','a','vote','yes'));
  result=public.group_room_action(a,'vote',jsonb_build_object('id',rid,'round',1,'place','b','vote','yes'));
  IF result->>'status'<>'swiping' OR result->'members'->a::text->'ranking' IS NULL THEN RAISE EXCEPTION 'Must auto-enter personal ranking'; END IF;
 END LOOP;
 result=public.group_room_action(host_id,'snapshot',jsonb_build_object('id',rid));
 IF result->'members'->guest_id::text ? 'preferences' OR result->'members'->guest_id::text->'ranking' ? 'ordered' THEN RAISE EXCEPTION 'Peer private data exposed'; END IF;
 IF NOT result->'members'->host_id::text->'ranking' ? 'ordered' THEN RAISE EXCEPTION 'Own ranking missing'; END IF;
 FOREACH a IN ARRAY people LOOP
  pair=jsonb_build_object('id',rid,'round',1,'candidate','b','against','a','preferred','b','step',0);
  result=public.group_room_action(a,'rank',pair);
 END LOOP;
 IF result->>'status'<>'results' OR result->'results'->0->>'id'<>'b' OR (result->'results'->0->>'score')::numeric<>100 THEN RAISE EXCEPTION 'Automatic results wrong'; END IF;
 result=public.group_room_action(guest_id,'rank',pair);
 IF result->>'status'<>'results' THEN RAISE EXCEPTION 'Final request retry broken'; END IF;
 BEGIN
  PERFORM public.group_room_action(gen_random_uuid(),'snapshot',jsonb_build_object('id',rid));
  RAISE EXCEPTION 'Outsider accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='Outsider accepted' THEN RAISE; END IF; END;
 IF has_function_privilege('authenticated','public.group_room_action(uuid,text,jsonb)','EXECUTE') OR has_function_privilege('anon','private.group_rank_choose(jsonb,jsonb)','EXECUTE') THEN RAISE EXCEPTION 'RPC permissions exposed'; END IF;
 -- The server refuses undersized decks even if a client/backend bypasses the search helper.
 UPDATE private.group_rooms SET state=state||jsonb_build_object('status','generating','lease','test-lease') WHERE id=rid;
 BEGIN
  PERFORM public.group_room_action(host_id,'publish',jsonb_build_object('id',rid,'lease','test-lease','deck',result->'deck'));
  RAISE EXCEPTION 'Undersized deck accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='Undersized deck accepted' THEN RAISE; END IF; END;
END $$;

ROLLBACK;
