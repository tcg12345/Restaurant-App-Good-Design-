-- Private, immutable evidence. Separate rows avoid whole-blob sync overwrites.
create table public.ranking_preference_events (
  user_id uuid not null references auth.users(id) on delete cascade,
  id uuid not null,
  event jsonb not null,
  received_at timestamptz not null default now(),
  primary key (user_id, id),
  constraint ranking_event_shape check ((
    jsonb_typeof(event) = 'object'
    and event @> '{"version":1,"orderBasis":"persisted-score-order"}'::jsonb
    and event ->> 'id' = id::text
    and event ->> 'kind' in ('rating','reorder','delete','snapshot')
    and event ->> 'source' in ('h2h','slider','import','manual-reorder','score-edit','system','legacy')
    and jsonb_typeof(event -> 'capturedAt') = 'number'
    and jsonb_typeof(event -> 'order') = 'array'
    and jsonb_typeof(event -> 'subjectIds') = 'array'
    and jsonb_typeof(event -> 'parentIds') = 'array'
    and jsonb_typeof(event -> 'comparisons') = 'array'
    and event ?& array['id','kind','source','capturedAt','order','subjectIds','parentIds','comparisons']
  ) is true)
);
alter table public.ranking_preference_events enable row level security;
revoke all on public.ranking_preference_events from public, anon, authenticated;
grant select, insert on public.ranking_preference_events to authenticated;
grant all on public.ranking_preference_events to service_role;
create policy "Read own ranking evidence" on public.ranking_preference_events
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Append own ranking evidence" on public.ranking_preference_events
  for insert to authenticated with check ((select auth.uid()) = user_id);
comment on table public.ranking_preference_events is
  'Private preference observations, never community votes. New events supersede via parentIds and subjectIds; account deletion cascades.';
