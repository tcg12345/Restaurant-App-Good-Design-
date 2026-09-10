-- Preserve the immutable journal and old clients; add an owner-scoped cursor.
-- A sequence or received_at alone is unsafe: allocation can precede a later
-- transaction's commit. Updating one clock row serializes each owner's writes
-- until commit, so a reader cannot skip an earlier uncommitted position.
create schema if not exists private;
create table private.ranking_evidence_clocks (
  user_id uuid primary key references auth.users(id) on delete cascade,
  position bigint not null check (position > 0)
);
alter table private.ranking_evidence_clocks enable row level security;
revoke all on private.ranking_evidence_clocks from public, anon, authenticated;
grant all on private.ranking_evidence_clocks to service_role;

alter table public.ranking_preference_events add column sync_position bigint;
with numbered as (
  select user_id, id, row_number() over (partition by user_id order by received_at, id) as position
  from public.ranking_preference_events
)
update public.ranking_preference_events e set sync_position = n.position
from numbered n where e.user_id = n.user_id and e.id = n.id;
insert into private.ranking_evidence_clocks(user_id, position)
select user_id, max(sync_position) from public.ranking_preference_events group by user_id;
alter table public.ranking_preference_events alter column sync_position set not null;
create unique index ranking_evidence_owner_position_idx
  on public.ranking_preference_events(user_id, sync_position);

create function private.stamp_ranking_evidence_position()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- RLS remains the authorization boundary. Check populated JWT identities
  -- before touching the counter too; trusted service imports have no uid.
  if auth.uid() is not null and auth.uid() is distinct from new.user_id then
    raise exception 'ranking evidence owner does not match session' using errcode = '42501';
  end if;
  insert into private.ranking_evidence_clocks as clocks(user_id, position)
    values (new.user_id, 1)
    on conflict (user_id) do update set position = clocks.position + 1
    returning position into new.sync_position;
  return new;
end;
$$;
revoke all on function private.stamp_ranking_evidence_position() from public, anon, authenticated;
create trigger ranking_evidence_position before insert on public.ranking_preference_events
  for each row execute function private.stamp_ranking_evidence_position();
comment on column public.ranking_preference_events.sync_position is
  'Server-assigned incremental-sync cursor, ordered by committed writes per owner. Not a preference, timestamp or score.';
