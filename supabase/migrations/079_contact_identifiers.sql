-- 079: Contact syncing — find friends from your address book.
-- ════════════════════════════════════════════════════════════════════
-- Two halves, deliberately separate consents (see 2a/2b of the plan):
--   • "let people who have my number find me" — set_my_contact_discoverability
--   • "find people I know"                    — match_contacts
-- A user may do either, both, or neither. Uploading contacts to FIND
-- people never requires being findable yourself; forced reciprocity is a
-- dark pattern, not a security control.
--
-- ── What is stored, and what is deliberately NOT ─────────────────────
-- Stored: one row per identifier the CALLER themselves owns, as an HMAC.
-- Never stored: anything from anyone's address book. match_contacts
-- compares inside the request and discards. That rules out a "someone
-- you know just joined" backlog, which is a real feature — it is not
-- worth permanently holding a copy of everyone's contacts to get it.
--
-- ── Why HMAC and not a plain hash ────────────────────────────────────
-- A bare SHA-256 of a phone number IS the phone number: ~10^10
-- candidates is minutes on a GPU. So the client sends sha256(normalized)
-- and the SERVER re-hashes that with a secret pepper before it ever
-- touches a table. A dump of this table is useless without the pepper,
-- which lives in Vault rather than in any table.
--
-- ── Why the caller's own identifiers come from auth.users ────────────
-- set_my_contact_discoverability reads auth.users and never accepts an
-- identifier argument. That is the whole basis of trust: you can only be
-- discovered by a number or address Supabase itself verified, so nobody
-- can claim someone else's and be found in their place.
--
-- ── PREREQUISITE ─────────────────────────────────────────────────────
-- Create the pepper ONCE before calling anything here, in the SQL editor:
--   select vault.create_secret(
--     encode(extensions.gen_random_bytes(32), 'hex'),
--     'contact_match_pepper',
--     'Pepper for user_contact_identifiers HMACs (079)');
-- Rotating it invalidates every stored row; users would have to re-opt-in.
--
-- Run this in your Supabase SQL Editor.

-- ── The table ────────────────────────────────────────────────────────
create table if not exists public.user_contact_identifiers (
  user_id    uuid not null references auth.users(id) on delete cascade,
  kind       text not null,
  hmac       text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, kind, hmac)
);

alter table public.user_contact_identifiers
  drop constraint if exists user_contact_identifiers_kind_check;
alter table public.user_contact_identifiers
  add constraint user_contact_identifiers_kind_check check (kind in ('phone', 'email'));

-- The lookup match_contacts drives.
create index if not exists idx_contact_identifiers_lookup
  on public.user_contact_identifiers (kind, hmac);

-- RLS on with NO policies: only the SECURITY DEFINER functions below ever
-- read or write this table. Note this is why it is NOT a column on
-- user_profiles, whose RLS is `FOR SELECT USING (true)` — world-readable
-- including anon. A hash there would be public.
alter table public.user_contact_identifiers enable row level security;

-- ── Pepper ───────────────────────────────────────────────────────────
-- Revoked from everyone: only the two definer functions below call it,
-- and they run as the owner. Same pattern as can_view_user_content (036).
create or replace function public.contact_pepper()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select decrypted_secret
  from vault.decrypted_secrets
  where name = 'contact_match_pepper'
  limit 1;
$$;

revoke all on function public.contact_pepper() from public, anon, authenticated;

-- ── Opt in / out of being discoverable ───────────────────────────────
-- Returns the number of identifier rows the caller now has: 0 after
-- opting out, and after opting IN it tells the client how discoverable
-- they actually are (an Apple private-relay account with no phone gets 0
-- back, which is the signal the UI needs to say so).
create or replace function public.set_my_contact_discoverability(enable boolean)
returns integer
language plpgsql
security definer
set search_path = ''
volatile
as $$
declare
  v_user uuid := auth.uid();
  v_pepper text;
  v_email text;
  v_phone text;
  v_count integer;
begin
  if v_user is null then
    raise exception 'not signed in' using errcode = 'insufficient_privilege';
  end if;

  -- Off means gone, not flagged: the honest reading of "stop letting
  -- people find me" is that the data is deleted.
  delete from public.user_contact_identifiers where user_id = v_user;
  if not enable then
    return 0;
  end if;

  v_pepper := public.contact_pepper();
  if v_pepper is null then
    raise exception 'contact_match_pepper is not set in Vault' using errcode = 'config_file_error';
  end if;

  select lower(trim(u.email)), u.phone into v_email, v_phone
  from auth.users u where u.id = v_user;

  -- Apple "Hide My Email" relay addresses exist in nobody's address book,
  -- so a row for one can never match anything — it would be PII at rest
  -- bought for exactly zero discoverability.
  if v_email is not null and v_email <> '' and v_email not like '%@privaterelay.appleid.com' then
    insert into public.user_contact_identifiers (user_id, kind, hmac)
    values (
      v_user, 'email',
      encode(extensions.hmac(encode(extensions.digest(v_email, 'sha256'), 'hex'), v_pepper, 'sha256'), 'hex')
    )
    on conflict do nothing;
  end if;

  -- Normalized to E.164 with a leading '+', byte-for-byte what
  -- src/lib/phone.ts#toE164 produces, because the two hashes have to
  -- match. GoTrue's storage has varied on keeping the '+', so rebuild it
  -- from the digits rather than trusting the stored form.
  if v_phone is not null and v_phone <> '' then
    insert into public.user_contact_identifiers (user_id, kind, hmac)
    values (
      v_user, 'phone',
      encode(extensions.hmac(
        encode(extensions.digest('+' || regexp_replace(v_phone, '\D', '', 'g'), 'sha256'), 'hex'),
        v_pepper, 'sha256'), 'hex')
    )
    on conflict do nothing;
  end if;

  select count(*) into v_count from public.user_contact_identifiers where user_id = v_user;
  return v_count;
end;
$$;

revoke all on function public.set_my_contact_discoverability(boolean) from public, anon;
grant execute on function public.set_my_contact_discoverability(boolean) to authenticated;

-- ── Match an address book against the user base ──────────────────────
-- Takes client-side sha256(normalized) hex digests; returns the user ids
-- that matched, each paired with the input hash that matched it. The
-- client resolves the ids against user_profiles, which is already
-- world-readable — the same split get_follow_list (062) uses: "only user
-- ids leave the database".
--
-- Echoing the matched hash back reveals nothing: the client sent it and
-- already knows which contact it came from. It is what lets the row say
-- "Maya Chen · in your contacts" instead of showing a bare profile the
-- user has to recognise unaided.
--
-- This is an oracle in exactly the sense migration 049 warns about, so:
-- authenticated-only, a hard batch cap, and an hourly per-user quota
-- through the existing consume_ai_rate_limit counter (047), which is
-- keyed on an arbitrary endpoint string. Twelve syncs an hour is far more
-- than any real person does and far less than a useful sweep.
drop function if exists public.match_contacts(text[]);
create or replace function public.match_contacts(p_hashes text[])
returns table (user_id uuid, contact_hash text)
language plpgsql
security definer
set search_path = ''
volatile
as $$
declare
  v_user uuid := auth.uid();
  v_pepper text;
begin
  if v_user is null then
    raise exception 'not signed in' using errcode = 'insufficient_privilege';
  end if;

  if p_hashes is null or array_length(p_hashes, 1) is null then
    return;
  end if;

  if array_length(p_hashes, 1) > 2000 then
    raise exception 'too many contacts in one request' using errcode = 'program_limit_exceeded';
  end if;

  if not public.consume_ai_rate_limit('contact_match', 12) then
    raise exception 'rate limit exceeded' using errcode = 'check_violation';
  end if;

  v_pepper := public.contact_pepper();
  if v_pepper is null then
    raise exception 'contact_match_pepper is not set in Vault' using errcode = 'config_file_error';
  end if;

  return query
  select distinct ci.user_id, h.hash
  from unnest(p_hashes) as h(hash)
  join public.user_contact_identifiers ci
    on ci.hmac = encode(extensions.hmac(h.hash, v_pepper, 'sha256'), 'hex')
  -- Never suggest yourself, and never suggest someone you already follow
  -- or have already asked — a "Follow" button on either reads as broken.
  -- Same exclusions getSuggestedProfiles applies.
  where ci.user_id <> v_user
    and not exists (
      select 1 from public.user_friends f
      where f.user_id = v_user and f.friend_id = ci.user_id
    );
end;
$$;

revoke all on function public.match_contacts(text[]) from public, anon;
grant execute on function public.match_contacts(text[]) to authenticated;

-- Verify (as a signed-in user, after creating the Vault secret):
--   select public.set_my_contact_discoverability(true);   -- 1 or 2
--   select * from public.match_contacts(array[encode(digest('+15125550134','sha256'),'hex')]);
--   select public.set_my_contact_discoverability(false);  -- 0, rows deleted
