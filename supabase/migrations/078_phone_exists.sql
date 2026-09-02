-- 078: phone_exists() — the phone-number twin of email_exists (032/049).
-- ════════════════════════════════════════════════════════════════════
-- Phone signup makes the auth screen identifier-first for a second channel:
-- type a number, and the screen has to decide whether to send you to
-- "sign in" or "create account" BEFORE spending an SMS. That is the same
-- question email_exists answers, so this is the same shape of function —
-- SECURITY DEFINER to see auth.users, returning only a boolean, callable
-- pre-auth because the welcome screen runs before sign-in.
--
-- ── Why the rate limiting is not optional here ───────────────────────
-- Migration 049 gated email_exists because an unauthenticated boolean
-- oracle "enables bulk user-enumeration". A phone oracle is strictly
-- worse: the keyspace is small enough to sweep (~10^10 and far less in
-- practice), and every hit is a real person's phone number rather than an
-- address you already had to guess. So this shares 049's limiter — the
-- SAME per-IP bucket as email_exists, deliberately, because an attacker
-- enumerating accounts is enumerating accounts regardless of which oracle
-- they point at. A legitimate user makes one or two of these calls per
-- sign-in; 30/minute is nowhere near them.
--
-- ── Why the comparison strips non-digits ─────────────────────────────
-- The client always sends E.164 ('+15125550134' — see src/lib/phone.ts),
-- but GoTrue's own storage convention for auth.users.phone has varied on
-- whether the leading '+' is kept. Comparing digits-only is correct under
-- either convention and costs nothing. The empty-string guard matters:
-- every email-only account has phone = NULL, and without it a blank probe
-- would normalize to '' on both sides and report a match against all of
-- them.
--
-- Run this in your Supabase SQL Editor.

-- ── The limiter table ────────────────────────────────────────────────
-- Declared here, not assumed. Migration 049 also creates this table, but
-- 049 was never applied to the live project (its has_password() function
-- is likewise absent — see the note in lib/AuthContext's verifyEmailCode).
-- Depending on it made phone_exists fail at runtime with
-- `relation "public.email_check_rate_limit" does not exist`, which the
-- client reports as "we couldn't check that number just now".
--
-- `IF NOT EXISTS` so this stays a no-op wherever 049 DID run — the
-- column list is identical, and the two functions deliberately share one
-- per-IP budget.
--
-- NOTE: because 049 is absent, the live email_exists() is migration
-- 032's UNRATE-LIMITED version. That oracle is still open; applying 049
-- (or re-creating just its email_exists) is worth doing separately.
create table if not exists public.email_check_rate_limit (
  ip text not null,
  window_start timestamptz not null,
  request_count integer not null default 0,
  primary key (ip, window_start)
);
-- RLS on with NO policies: only the SECURITY DEFINER functions (running
-- as the table owner) ever touch this; anon/authenticated cannot read or
-- write it directly.
alter table public.email_check_rate_limit enable row level security;

-- VOLATILE (not STABLE): the rate-limit bookkeeping does INSERT/DELETE,
-- which Postgres forbids inside a non-volatile function.
create or replace function public.phone_exists(check_phone text)
returns boolean
language plpgsql
security definer
set search_path = ''
volatile
as $$
declare
  -- Shared with email_exists (049): one existence-probe budget per IP.
  max_per_minute constant integer := 30;
  client_ip text;
  -- Named v_window (not window_start) so it never shadows the column of
  -- that name in the statements below.
  v_window timestamptz := date_trunc('minute', clock_timestamp());
  hits integer;
  digits text;
begin
  digits := regexp_replace(coalesce(check_phone, ''), '\D', '', 'g');
  -- Nothing dialable was sent. Answer before spending a rate-limit slot:
  -- this is a client bug or a probe, not a user.
  if digits = '' then
    return false;
  end if;

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
    select 1 from auth.users u
    where coalesce(u.phone, '') <> ''
      and regexp_replace(u.phone, '\D', '', 'g') = digits
  );
end;
$$;

revoke all on function public.phone_exists(text) from public;
grant execute on function public.phone_exists(text) to anon, authenticated;

-- Verify:
--   select public.phone_exists('+15125550134');  -- false on a fresh project
--   select public.phone_exists('');              -- false, and costs no quota
