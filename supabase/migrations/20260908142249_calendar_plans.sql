-- Private dining and cooking plans. No notification jobs are enabled by this migration.
create table public.calendar_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('restaurant', 'recipe')),
  title text not null check (length(btrim(title)) between 1 and 160),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'planned' check (status in ('planned', 'completed', 'cancelled')),
  review_state text not null default 'pending' check (review_state in ('pending', 'dismissed', 'reviewed')),
  snoozed_until timestamptz,
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object' and octet_length(details::text) <= 32768),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at and ends_at <= starts_at + interval '24 hours')
);
create index calendar_plans_owner_start on public.calendar_plans(user_id, starts_at);
alter table public.calendar_plans enable row level security;
revoke all on public.calendar_plans from anon, authenticated;
grant select, insert, update, delete on public.calendar_plans to authenticated;
create policy "Owners read plans" on public.calendar_plans for select to authenticated using ((select auth.uid()) = user_id);
create policy "Owners create plans" on public.calendar_plans for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Owners update plans" on public.calendar_plans for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Owners delete plans" on public.calendar_plans for delete to authenticated using ((select auth.uid()) = user_id);
create function public.stamp_calendar_plan() returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  if tg_op = 'INSERT' then new.created_at := now(); else new.created_at := old.created_at; end if;
  return new;
end;
$$;
revoke all on function public.stamp_calendar_plan() from public;
create trigger stamp_calendar_plan before insert or update on public.calendar_plans for each row execute function public.stamp_calendar_plan();
