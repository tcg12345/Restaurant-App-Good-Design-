-- Server-authored events, owner preferences, session-bound APNs installations,
-- and an outbox that stays dormant until an APNs dispatcher is configured.
create schema if not exists notification_private;
revoke all on schema notification_private from public, anon, authenticated;

create table public.notification_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default false,
  categories jsonb not null default '{"friends":true,"messages":true,"activity":true,"shared_lists":true,"plans":true,"reviews":true,"recaps":true,"account":true}',
  previews boolean not null default false,
  sound boolean not null default true,
  reminder_minutes integer not null default 60 check (reminder_minutes in (0,15,30,60,120,1440)),
  quiet_enabled boolean not null default false,
  quiet_start text not null default '22:00' check (quiet_start ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  quiet_end text not null default '08:00' check (quiet_end ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  timezone text not null default 'UTC' check (length(timezone) between 1 and 100),
  check (jsonb_typeof(categories)='object' and octet_length(categories::text)<1024)
);
-- Validate keys and boolean values without treating user JSON as trusted SQL.
create function notification_private.validate_preferences() returns trigger language plpgsql set search_path='' as $$
begin
  if exists(select 1 from jsonb_each(new.categories) e where e.key not in ('friends','messages','activity','shared_lists','plans','reviews','recaps','account') or jsonb_typeof(e.value)<>'boolean')
     or octet_length(new.categories::text)>1024 then raise exception 'Invalid notification categories'; end if;
  if not exists(select 1 from pg_timezone_names where name=new.timezone) then raise exception 'Invalid time zone'; end if;
  return new;
end $$;
create trigger validate_notification_preferences before insert or update on public.notification_preferences for each row execute function notification_private.validate_preferences();
alter table public.notification_preferences enable row level security;
revoke all on public.notification_preferences from anon, authenticated;
grant select, insert, update, delete on public.notification_preferences to authenticated;
create policy "Own notification preferences" on public.notification_preferences for all to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);

create table notification_private.devices (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null unique,
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null references auth.sessions(id) on delete cascade,
  token text not null unique check (token ~ '^[a-f0-9]+$' and length(token) between 32 and 512),
  environment text not null check (environment in ('development','production')),
  updated_at timestamptz not null default now()
);
create index notification_devices_user on notification_private.devices(user_id);
alter table notification_private.devices enable row level security;

create function public.register_push_device(p_installation_id uuid, p_token text, p_environment text)
returns void language plpgsql security definer set search_path='' as $$
declare uid uuid := auth.uid(); sid uuid := (auth.jwt()->>'session_id')::uuid;
begin
  if uid is null or not exists(select 1 from auth.sessions s where s.id=sid and s.user_id=uid and (s.not_after is null or s.not_after>now())) then raise exception 'Sign in again to enable notifications'; end if;
  if (p_token !~ '^[a-f0-9]+$' or length(p_token) not between 32 and 512) or p_environment not in ('development','production') then raise exception 'Invalid APNs registration'; end if;
  -- The APNs token is an installation-specific bearer value issued by Apple.
  -- Account switches must remove the old binding, including its queued work.
  delete from notification_private.devices where (installation_id=p_installation_id or token=p_token) and (user_id<>uid or session_id<>sid or token<>p_token);
  insert into notification_private.devices(installation_id,user_id,session_id,token,environment)
    values(p_installation_id,uid,sid,p_token,p_environment)
    on conflict(installation_id) do update set token=excluded.token,environment=excluded.environment,updated_at=now();
end $$;
revoke all on function public.register_push_device(uuid,text,text) from public, anon;
grant execute on function public.register_push_device(uuid,text,text) to authenticated;
create function public.unregister_push_device(p_installation_id uuid) returns void language sql security definer set search_path='' as $$
  delete from notification_private.devices where installation_id=p_installation_id and user_id=(select auth.uid());
$$;
revoke all on function public.unregister_push_device(uuid) from public, anon;
grant execute on function public.unregister_push_device(uuid) to authenticated;

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications drop constraint notifications_subject_type_check;
alter table public.notifications add constraint notifications_kind_check check(kind in ('like','comment','cuisine_suggested','cuisine_auto','friend_request','friend_accepted','message','shared_list_invite','shared_list_update','recap','account'));
alter table public.notifications add constraint notifications_subject_type_check check(subject_type in ('post','reel','rating','cuisine','friend','conversation','shared_list','recap','account'));
alter table public.notifications add column title text not null default '';
alter table public.notifications add column path text;
alter table public.notifications add column event_key text;
create unique index notifications_event_key on public.notifications(user_id,event_key) where event_key is not null;
-- Existing owner-update RLS is retained, but only read_at is writable. Clients
-- must never be able to forge notification content and have it delivered.
revoke update on public.notifications from authenticated, anon;
grant update(read_at) on public.notifications to authenticated;

create table notification_private.outbox (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications(id) on delete cascade,
  device_id uuid not null references notification_private.devices(id) on delete cascade,
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  lease_id uuid,
  leased_until timestamptz,
  delivered_at timestamptz,
  last_error text,
  unique(notification_id,device_id)
);
alter table notification_private.outbox enable row level security;
create index notification_outbox_due on notification_private.outbox(available_at) where delivered_at is null and attempts<8;

create function notification_private.category(kind text) returns text language sql immutable set search_path='' as $$
 select case when kind in ('friend_request','friend_accepted') then 'friends' when kind='message' then 'messages'
 when kind in ('shared_list_invite','shared_list_update') then 'shared_lists' when kind='recap' then 'recaps'
 when kind='account' then 'account' else 'activity' end;
$$;
create function notification_private.enqueue() returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into notification_private.outbox(notification_id,device_id)
  select new.id,d.id from notification_private.devices d join public.notification_preferences p on p.user_id=d.user_id
  where d.user_id=new.user_id and p.enabled and coalesce((p.categories->>notification_private.category(new.kind))::boolean,true)
    and new.kind not in ('cuisine_suggested','cuisine_auto')
  on conflict do nothing;
  return new;
end $$;
create trigger enqueue_notification after insert on public.notifications for each row execute function notification_private.enqueue();

create function notification_private.emit(uid uuid, actor uuid, kind text, subject text, subject_id uuid, title text, body text, path text, event_key text)
returns void language sql security definer set search_path='' as $$
 insert into public.notifications(user_id,actor_id,kind,subject_type,subject_id,title,preview,path,event_key)
 values(uid,coalesce(actor,uid),kind,subject,subject_id,left(title,160),left(body,240),path,event_key)
 on conflict(user_id,event_key) where event_key is not null do nothing;
$$;
create function notification_private.friend_event() returns trigger language plpgsql security definer set search_path='' as $$
declare actor_name text;
begin
 if tg_op='INSERT' and new.status='pending' then
   select coalesce(nullif(display_name,''),'Someone') into actor_name from public.user_profiles where user_id=new.user_id;
   perform notification_private.emit(new.friend_id,new.user_id,'friend_request','friend',new.id,'New friend request',coalesce(actor_name,'Someone')||' would like to connect.','/messages?tab=friends','friend-request:'||new.id);
 elsif tg_op='UPDATE' and old.status='pending' and new.status='accepted' then
   select coalesce(nullif(display_name,''),'Your friend') into actor_name from public.user_profiles where user_id=new.friend_id;
   perform notification_private.emit(new.user_id,new.friend_id,'friend_accepted','friend',new.id,'You’re connected',coalesce(actor_name,'Your friend')||' accepted your request.','/messages?tab=friends','friend-accepted:'||new.id);
 end if;
 return new;
end $$;
create trigger notify_friend_event after insert or update of status on public.user_friends for each row execute function notification_private.friend_event();
create function notification_private.message_event() returns trigger language plpgsql security definer set search_path='' as $$
declare recipient uuid; actor_name text; participants uuid[];
begin
 select participant_ids into participants from public.conversations where id=new.conversation_id;
 -- Ignore malformed/system writes from nonparticipants.
 if not(new.sender_id=any(participants)) then return new; end if;
 select coalesce(nullif(display_name,''),'A friend') into actor_name from public.user_profiles where user_id=new.sender_id;
 foreach recipient in array participants loop
   if recipient<>new.sender_id then
     perform notification_private.emit(recipient,new.sender_id,'message','conversation',new.conversation_id,coalesce(actor_name,'New message'),
       case when coalesce(new.text,'')<>'' then new.text else 'Shared something with you' end,
       '/messages?conversation='||new.conversation_id,'message:'||new.id);
   end if;
 end loop;
 return new;
end $$;
create trigger notify_message after insert on public.messages for each row execute function notification_private.message_event();
create function notification_private.read_messages() returns trigger language plpgsql security definer set search_path='' as $$
begin
 update public.notifications set read_at=new.last_read_at where user_id=new.user_id and kind='message' and subject_id=new.conversation_id and created_at<=new.last_read_at and read_at is null;
 return new;
end $$;
create trigger read_message_notifications after insert or update on public.conversation_reads for each row execute function notification_private.read_messages();
create function notification_private.list_event() returns trigger language plpgsql security definer set search_path='' as $$
declare recipient uuid; previous uuid[] := '{}'; list public.shared_lists;
begin
 if tg_table_name='shared_lists' then
   if tg_op='UPDATE' then previous:=old.member_ids; end if;
   foreach recipient in array new.member_ids loop
    if recipient<>new.owner_id and not(recipient=any(previous)) then
     perform notification_private.emit(recipient,new.owner_id,'shared_list_invite','shared_list',new.id,'You’re on the list',new.name,'/pantry?shared='||new.id,'list-invite:'||new.id||':'||new.updated_at);
    end if;
   end loop;
 else
   select * into list from public.shared_lists where id=new.list_id;
   foreach recipient in array list.member_ids loop
    if recipient<>new.added_by then
     perform notification_private.emit(recipient,new.added_by,'shared_list_update','shared_list',list.id,'A new place to try',new.name||' was added to '||list.name,'/pantry?shared='||list.id,'list-entry:'||new.id);
    end if;
   end loop;
 end if;
 return new;
end $$;
create trigger notify_list_invite after insert or update of member_ids on public.shared_lists for each row execute function notification_private.list_event();
create trigger notify_list_entry after insert on public.shared_list_entries for each row execute function notification_private.list_event();
create function notification_private.account_event() returns trigger language plpgsql security definer set search_path='' as $$
declare body text;
begin
 if tg_table_name='verification_requests' then
  if new.status=old.status or new.status='pending' then return new; end if;
  perform notification_private.emit(new.user_id,null,'account','account',new.id,'Your verification update is ready','Open GoodEats to see the decision.','/settings/verification','verification:'||new.id||':'||new.status);
 else
  if new.user_id is null then return new; end if;
  body := case new.type when 'BILLING_ISSUE' then 'Your membership needs attention. Check your payment details.' when 'EXPIRATION' then 'Your Pro membership has ended.' when 'CANCELLATION' then 'Your membership renewal has been cancelled.' when 'INITIAL_PURCHASE' then 'Welcome to GoodEats Pro.' when 'PRODUCT_CHANGE' then 'Your membership has changed.' else null end;
  if body is not null then perform notification_private.emit(new.user_id,null,'account','account',new.user_id,'GoodEats Pro',body,'/settings/subscription','subscription:'||new.id); end if;
 end if;
 return new;
end $$;
create trigger notify_verification after update of status on public.verification_requests for each row execute function notification_private.account_event();
create trigger notify_subscription after insert on public.subscription_events for each row execute function notification_private.account_event();

-- Service-only leased batches. Session revocation, preferences and read state
-- are checked at send time as well as enqueue time.
create function public.claim_push_notifications(p_limit integer default 40) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 delete from notification_private.outbox q using public.notifications n where q.notification_id=n.id and n.created_at<now()-interval '3 days';
 with picked as (
  select q.id from notification_private.outbox q join public.notifications n on n.id=q.notification_id
  join notification_private.devices d on d.id=q.device_id join auth.sessions s on s.id=d.session_id
  join public.notification_preferences p on p.user_id=d.user_id
  where q.delivered_at is null and q.attempts<8 and q.available_at<=now() and (q.leased_until is null or q.leased_until<now())
   and n.read_at is null and p.enabled and coalesce((p.categories->>notification_private.category(n.kind))::boolean,true)
   and (s.not_after is null or s.not_after>now()) and s.user_id=d.user_id
   and (n.kind<>'message' or exists(select 1 from public.conversations c where c.id=n.subject_id and d.user_id=any(c.participant_ids)))
   and (n.subject_type<>'shared_list' or exists(select 1 from public.shared_lists l where l.id=n.subject_id and d.user_id=any(l.member_ids)))
   and (n.kind<>'friend_request' or exists(select 1 from public.user_friends f where f.id=n.subject_id and f.status='pending'))
  order by q.available_at for update of q skip locked limit least(greatest(p_limit,1),100)
 ), claimed as (
  update notification_private.outbox q set attempts=q.attempts+1,lease_id=gen_random_uuid(),leased_until=now()+interval '2 minutes' from picked where q.id=picked.id returning q.*
 ) select coalesce(jsonb_agg(jsonb_build_object('id',q.id,'lease_id',q.lease_id,'attempts',q.attempts,'device_id',d.id,'token',d.token,'environment',d.environment,'notification',to_jsonb(n),'preferences',to_jsonb(p),'badge',(select count(*) from public.notifications b where b.user_id=n.user_id and b.read_at is null))), '[]') into result
 from claimed q join public.notifications n on n.id=q.notification_id join notification_private.devices d on d.id=q.device_id join public.notification_preferences p on p.user_id=d.user_id;
 return result;
end $$;
create function public.finish_push_notification(p_id uuid,p_lease_id uuid,p_result text,p_retry_at timestamptz default null) returns void language plpgsql security definer set search_path='' as $$
begin
 if p_result='invalid_token' then
  delete from notification_private.devices d using notification_private.outbox q where q.id=p_id and q.lease_id=p_lease_id and d.id=q.device_id;
 else
  update notification_private.outbox set delivered_at=case when p_result in ('sent','discarded') then now() else null end,
   attempts=case when p_result='deferred' then greatest(0,attempts-1) else attempts end,
   available_at=coalesce(p_retry_at,now()+make_interval(secs=>least(21600,power(2,attempts)::integer*30))),
   last_error=case when p_result='sent' then null else left(p_result,160) end,leased_until=null,lease_id=null
   where id=p_id and lease_id=p_lease_id;
 end if;
end $$;
revoke all on function public.claim_push_notifications(integer), public.finish_push_notification(uuid,uuid,text,timestamptz) from public, anon, authenticated;
grant execute on function public.claim_push_notifications(integer), public.finish_push_notification(uuid,uuid,text,timestamptz) to service_role;

-- Recaps use actual closed-period activity. Overlapping weekly/monthly/yearly
-- boundaries produce just the largest recap. Stable keys prevent repeats.
create function notification_private.create_recaps() returns void language plpgsql security definer set search_path='' as $$
declare p record; today date; start_day date; label text; period_key text;
begin
 for p in select * from public.notification_preferences where enabled and coalesce((categories->>'recaps')::boolean,true) loop
  today := (now() at time zone p.timezone)::date;
  if (now() at time zone p.timezone)::time < time '09:00' then continue; end if;
  if extract(month from today)=1 and extract(day from today)=1 then start_day:=(today-interval '1 year')::date; label:='year';
  elsif extract(day from today)=1 then start_day:=(today-interval '1 month')::date; label:='month';
  elsif extract(isodow from today)=1 then start_day:=today-7; label:='week'; else continue; end if;
  period_key:='recap:'||label||':'||today;
  if exists(select 1 from public.community_ratings r where r.user_id=p.user_id and r.visit_date>=start_day::text and r.visit_date<today::text)
   or exists(select 1 from public.user_app_data a cross join lateral jsonb_array_elements(case when jsonb_typeof(a.restaurant_meta->'__home_meals__')='array' then a.restaurant_meta->'__home_meals__' else '[]'::jsonb end) m
     where a.user_id=p.user_id and m->>'date'>=start_day::text and m->>'date'<today::text)
   or exists(select 1 from public.recipes r where r.user_id=p.user_id and (r.created_at at time zone p.timezone)::date>=start_day and (r.created_at at time zone p.timezone)::date<today)
   then
   perform notification_private.emit(p.user_id,null,'recap','recap',p.user_id,'Your '||label||' in food','Take a look back at the places and flavors you enjoyed.','/settings/reviews',period_key);
  end if;
 end loop;
end $$;
revoke all on all functions in schema notification_private from public, anon, authenticated;

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
create function notification_private.dispatch_tick() returns void language plpgsql security definer set search_path='' as $$
declare endpoint text; secret text;
begin
 delete from notification_private.outbox q using public.notifications n where q.notification_id=n.id and n.created_at<now()-interval '3 days';
 perform notification_private.create_recaps();
 select decrypted_secret into endpoint from vault.decrypted_secrets where name='goodeats_push_url' limit 1;
 select decrypted_secret into secret from vault.decrypted_secrets where name='goodeats_push_dispatch_secret' limit 1;
 if endpoint is not null and secret is not null then
  perform net.http_post(url:=endpoint,headers:=jsonb_build_object('Content-Type','application/json','x-dispatch-secret',secret),body:='{}'::jsonb,timeout_milliseconds:=55000);
 end if;
end $$;
revoke all on function notification_private.dispatch_tick() from public, anon, authenticated;
select cron.schedule('goodeats-push-dispatch','* * * * *','select notification_private.dispatch_tick()');
