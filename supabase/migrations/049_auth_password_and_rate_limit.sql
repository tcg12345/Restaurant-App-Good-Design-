-- 049: Auth hardening for the email-first sign-in screen.
-- ════════════════════════════════════════════════════════════════════
-- Two changes, both driven by the email-first flow:
--
-- 1. has_password() — lets the client tell, AFTER an OTP verification, whether
--    the just-verified account already has a password. The email-first signup
--    path optimistically routes a "new" account to a choose-password screen;
--    if checkEmailExists mis-detected an EXISTING account as new, that screen
--    would silently RESET the returning user's password. With this the client
--    only shows password setup for genuinely passwordless accounts.
--
-- 2. email_exists() rate limiting — the function (migration 032) is an
--    unauthenticated boolean oracle: "is this email registered?". Left
--    ungated it enables bulk user-enumeration. We now cap calls per client IP
--    per minute and raise (which the client reads as "unknown" and offers a
--    retry) once the cap is exceeded.

-- ── 1. has_password() ────────────────────────────────────────────────
-- Runs as the signed-in caller (auth.uid()); returns true only when the
-- account has a real password set. OTP-only / OAuth accounts return false.
create or replace function public.has_password()
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1 from auth.users
    where id = auth.uid()
      and encrypted_password is not null
      and encrypted_password <> ''
  );
$$;

revoke all on function public.has_password() from public, anon;
grant execute on function public.has_password() to authenticated;

-- ── 2. email_exists() per-IP rate limiting ───────────────────────────
create table if not exists public.email_check_rate_limit (
  ip text not null,
  window_start timestamptz not null,
  request_count integer not null default 0,
  primary key (ip, window_start)
);
-- RLS on with NO policies: only the SECURITY DEFINER function (running as the
-- table owner) ever touches this table; anon/authenticated can't read or write
-- it directly.
alter table public.email_check_rate_limit enable row level security;

-- VOLATILE (not STABLE): the rate-limit bookkeeping does INSERT/DELETE, which
-- Postgres forbids inside a non-volatile function.
create or replace function public.email_exists(check_email text)
returns boolean
language plpgsql
security definer
set search_path = ''
volatile
as $$
declare
  -- Max email_exists() calls allowed per client IP per clock minute.
  max_per_minute constant integer := 30;
  client_ip text;
  -- Named v_window (not window_start) so it never shadows the column of that
  -- name in the statements below.
  v_window timestamptz := date_trunc('minute', clock_timestamp());
  hits integer;
begin
  -- Client IP from the forwarded header PostgREST exposes; falls back to a
  -- single shared bucket when there's no header (e.g. SQL editor).
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
    select 1 from auth.users
    where lower(email) = lower(trim(check_email))
  );
end;
$$;

revoke all on function public.email_exists(text) from public;
grant execute on function public.email_exists(text) to anon, authenticated;
