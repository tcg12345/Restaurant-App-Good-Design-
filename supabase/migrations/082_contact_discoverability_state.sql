-- 082 — "am I findable?", the read half of 079.
--
-- 079 shipped a setter with no getter, so the Add-friends card had no way
-- to know its own state: `discoverable` started false on every mount, and
-- the button offered "Turn on" to people who had already turned it on.
--
-- Returns the KINDS stored for the caller ('email', 'phone') rather than a
-- bare boolean, because the card asks two different questions of this:
-- whether the toggle is on, and whether adding a phone number would widen
-- who can reach them. Address books hold numbers far more reliably than
-- addresses, so "findable by email only" is a real, weaker state and the
-- UI should be able to say so.
--
-- Nothing about anyone else can leave: the function takes no argument and
-- is keyed on auth.uid(), the same shape as 046's can_view_author. The
-- hashes themselves are never returned — being told you have an 'email'
-- row tells you only what you already know about yourself.
--
-- Run this in your Supabase SQL Editor.

create or replace function public.my_contact_discoverability()
returns text[]
language sql
security definer
set search_path = ''
stable
as $$
  select coalesce(array_agg(distinct ci.kind order by ci.kind), array[]::text[])
  from public.user_contact_identifiers ci
  where auth.uid() is not null
    and ci.user_id = auth.uid();
$$;

-- Inherently personal — no anon, same as 079's match_contacts.
revoke all on function public.my_contact_discoverability() from public, anon;
grant execute on function public.my_contact_discoverability() to authenticated;

-- Verify (as a signed-in user):
--   select public.set_my_contact_discoverability(true);   -- 1 or 2
--   select public.my_contact_discoverability();           -- {email} or {email,phone}
--   select public.set_my_contact_discoverability(false);  -- 0
--   select public.my_contact_discoverability();           -- {}
