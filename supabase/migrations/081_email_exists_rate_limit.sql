-- 081: Close the unrate-limited email_exists enumeration oracle.
-- ════════════════════════════════════════════════════════════════════
-- Migration 049 was written to do this and was never applied to the live
-- project — discovered while wiring phone_exists (078), which failed at
-- runtime because 049's `email_check_rate_limit` table didn't exist. So
-- the live email_exists() is still migration 032's version: an
-- UNAUTHENTICATED boolean oracle answering "is this email registered?"
-- with no cap. 049 stated the problem plainly: "Left ungated it enables
-- bulk user-enumeration."
--
-- This applies ONLY 049's email_exists replacement, deliberately not its
-- has_password(). That function is dead by design: GoTrue stamps a
-- random encrypted_password the moment signInWithOtp CREATES a user, so
-- "has a real password" is server-undetectable, and the signup path now
-- ALWAYS routes to choose-password instead of asking. Re-creating it
-- would add a function whose answer is meaningless — see the long
-- comment in AuthContext.verifyEmailCode for the full story.
--
-- The limiter table itself is created by 078 (also `IF NOT EXISTS`
-- there), and phone_exists shares this same per-IP bucket on purpose: an
-- attacker enumerating accounts is enumerating accounts regardless of
-- which oracle they point at.
--
-- Behaviour on trip: raises, which the client's checkEmailExists reads
-- as 'unknown' — NOT 'no' — so a real user is told to retry rather than
-- being railroaded into the signup flow. See AuthContext.
--
-- Run this in your Supabase SQL Editor.

create table if not exists public.email_check_rate_limit (
  ip text not null,
  window_start timestamptz not null,
  request_count integer not null default 0,
  primary key (ip, window_start)
);
alter table public.email_check_rate_limit enable row level security;

-- VOLATILE (not STABLE): the rate-limit bookkeeping does INSERT/DELETE,
-- which Postgres forbids inside a non-volatile function.
create or replace function public.email_exists(check_email text)
returns boolean
language plpgsql
security definer
set search_path = ''
volatile
as $$
declare
  -- Shared with phone_exists (078): one existence-probe budget per IP.
  max_per_minute constant integer := 30;
  client_ip text;
  -- Named v_window (not window_start) so it never shadows the column of
  -- that name in the statements below.
  v_window timestamptz := date_trunc('minute', clock_timestamp());
  hits integer;
  addr text;
begin
  addr := lower(trim(coalesce(check_email, '')));
  -- Nothing to look up. Answer before spending a rate-limit slot, the
  -- same way phone_exists treats a blank probe.
  if addr = '' then
    return false;
  end if;

  -- Client IP from the forwarded header PostgREST exposes; falls back to
  -- a single shared bucket when there's no header (e.g. SQL editor).
  client_ip := split_part(
    coalesce(
      nullif(current_setting('request.headers', true), '')::json ->> 'x-forwarded-for',
      'unknown'
    ), ',', 1);

  -- Prune this IP's stale windows, then count this call against the current one.
  delete from public.email_check_rate_limit
    where ip = client_ip and window_start < clock_timestamp() - interval '1 hour';

  insert into public.email_check_rate_limit as r (ip, window_start, request_count)
    values (client_ip, v_window, 1)
    on conflict (ip, window_start)
    do update set request_count = r.request_count + 1
    returning request_count into hits;

  if hits > max_per_minute then
    raise exception 'rate limit exceeded' using errcode = 'check_violation';
  end if;

  return exists (
    select 1 from auth.users u
    where lower(u.email) = addr
  );
end;
$$;

revoke all on function public.email_exists(text) from public;
grant execute on function public.email_exists(text) to anon, authenticated;

-- Verify:
--   select public.email_exists('nobody@example.com');  -- false
--   select public.email_exists('');                    -- false, costs no quota
