-- Run inside a transaction and roll back. Uses temporary room fixtures only;
-- does not create accounts or alter any existing room or profile.
do $$
declare people uuid[]; host_id uuid; guest_id uuid; room_id uuid := gen_random_uuid(); closed_id uuid := gen_random_uuid(); listed jsonb; denied boolean := false;
begin
 select array_agg(id) into people from (select id from auth.users order by id limit 2) users;
 if array_length(people,1)<2 then raise exception 'Two existing users are needed for this rollback-only check'; end if;
 host_id:=people[1]; guest_id:=people[2];
 insert into private.group_rooms(id,code,host,state)
 values(room_id,upper(substr(replace(room_id::text,'-',''),1,8)),host_id,
 jsonb_build_object('host',host_id,'status','lobby','location',jsonb_build_object('label','QA'),'members',jsonb_build_object(host_id::text,jsonb_build_object('preferences','{}'::jsonb),guest_id::text,jsonb_build_object('preferences','{}'::jsonb))));
 insert into private.group_rooms(id,code,host,state)
 values(closed_id,upper(substr(replace(closed_id::text,'-',''),1,8)),host_id,
 jsonb_build_object('host',host_id,'status','closed','members',jsonb_build_object(host_id::text,'{}'::jsonb)));
 listed:=public.group_room_action(host_id,'list');
 if not exists(select 1 from jsonb_array_elements(listed) item where item->>'id'=room_id::text and item->>'host'=host_id::text) then raise exception 'Active room missing ownership'; end if;
 if exists(select 1 from jsonb_array_elements(listed) item where item->>'id'=closed_id::text) then raise exception 'Closed room appeared'; end if;
 begin
  perform public.group_room_action(guest_id,'cancel',jsonb_build_object('id',room_id));
 exception when others then
  if sqlerrm='Only the host can do that.' then denied:=true; else raise; end if;
 end;
 if not denied then raise exception 'Guest could delete a host room'; end if;
 perform public.group_room_action(host_id,'cancel',jsonb_build_object('id',room_id));
 listed:=public.group_room_action(host_id,'list');
 if exists(select 1 from jsonb_array_elements(listed) item where item->>'id'=room_id::text) then raise exception 'Deleted room remained in host list'; end if;
 listed:=public.group_room_action(guest_id,'list');
 if exists(select 1 from jsonb_array_elements(listed) item where item->>'id'=room_id::text) then raise exception 'Deleted room remained in guest list'; end if;
 if not exists(select 1 from private.group_rooms where id=room_id and host=host_id) then raise exception 'Closing erased the weekly allowance record'; end if;
 if has_function_privilege('authenticated','public.group_room_action(uuid,text,jsonb)','execute') or has_function_privilege('anon','public.group_room_action(uuid,text,jsonb)','execute') then raise exception 'Room write permissions changed'; end if;
end $$;
