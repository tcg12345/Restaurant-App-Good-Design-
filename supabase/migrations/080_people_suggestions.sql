-- 080: get_social_suggestions() — the graph half of "people you may know".
-- ════════════════════════════════════════════════════════════════════
-- The suggestion rail used to pull 60 arbitrary public profiles
-- (`.limit(60)` with no ordering) and rank them on taste similarity plus
-- account-quality tiebreakers. Two problems: the candidate POOL was
-- essentially random, and the ranking knew nothing about the social
-- graph — so it suggested plausible strangers rather than people you
-- plausibly know.
--
-- This function fixes the pool and supplies the signals the client can't
-- compute for itself. It has to be SECURITY DEFINER: user_friends' RLS
-- only exposes rows touching the caller, so "who do my friends follow"
-- and "who else rated the places I rated" are both unanswerable from the
-- client. Same shape as get_follow_list (062) and get_follow_counts
-- (052).
--
-- ── What leaves the database ─────────────────────────────────────────
-- User ids and small integers. No profile fields, no restaurant ids, no
-- scores — the client resolves ids against user_profiles, which is
-- already world-readable. 062 states the principle: "Only user ids leave
-- the database".
--
-- ── Why this is not an enumeration risk ──────────────────────────────
-- Unlike match_contacts (079), the caller supplies NO input to probe
-- with. It reads auth.uid() internally and answers only about the
-- caller's own neighbourhood, so there is nothing to sweep — the same
-- reasoning as can_view_author (046).
--
-- Run this in your Supabase SQL Editor.

create or replace function public.get_social_suggestions(p_limit integer default 60)
returns table (
  user_id uuid,
  -- People the caller follows who also follow this candidate. The
  -- classic PYMK signal.
  mutual_count integer,
  -- This candidate already follows the caller. Highest-conversion
  -- suggestion there is, and free to compute.
  follows_you boolean,
  -- Restaurants both the caller and the candidate have rated.
  co_rated_count integer,
  -- Of those, how many they scored within 1.5 points of each other.
  -- Rating the same places says you go to the same places; AGREEING on
  -- them says you'd trust their next recommendation.
  co_rated_agreement integer
)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (select auth.uid() as id),
  -- Everyone the caller already follows or has asked to follow. Both are
  -- excluded from suggestions: a "Follow" button on either reads as
  -- broken. (Matches getSuggestedProfiles' own exclusions.)
  my_edges as (
    select f.friend_id as id
    from public.user_friends f, me
    where f.user_id = me.id
  ),
  my_follows as (
    select f.friend_id as id
    from public.user_friends f, me
    where f.user_id = me.id and f.status = 'accepted'
  ),
  -- Candidate pool, graph-driven rather than arbitrary:
  --   friends-of-friends, plus anyone who already follows me.
  friends_of_friends as (
    select f2.friend_id as id, count(*)::integer as mutuals
    from my_follows mf
    join public.user_friends f2
      on f2.user_id = mf.id and f2.status = 'accepted'
    group by f2.friend_id
  ),
  my_followers as (
    select f.user_id as id
    from public.user_friends f, me
    where f.friend_id = me.id and f.status = 'accepted'
  ),
  candidates as (
    select id from friends_of_friends
    union
    select id from my_followers
  ),
  -- Co-rating overlap. Bounded by the caller's own rating count, so this
  -- costs nothing for a new account and stays proportional for a heavy one.
  my_ratings as (
    select r.restaurant_id, r.score
    from public.community_ratings r, me
    where r.user_id = me.id
  ),
  co_rated as (
    select r.user_id as id,
           count(*)::integer as n,
           count(*) filter (where abs(r.score - mine.score) <= 1.5)::integer as agree
    from public.community_ratings r
    join my_ratings mine on mine.restaurant_id = r.restaurant_id
    join candidates c on c.id = r.user_id
    group by r.user_id
  )
  select
    c.id,
    coalesce(fof.mutuals, 0),
    exists (select 1 from my_followers mf where mf.id = c.id),
    coalesce(cr.n, 0),
    coalesce(cr.agree, 0)
  from candidates c
  left join friends_of_friends fof on fof.id = c.id
  left join co_rated cr on cr.id = c.id
  cross join me
  where c.id is not null
    and c.id <> me.id
    and not exists (select 1 from my_edges e where e.id = c.id)
    -- Private accounts can still be suggested (a request is the point),
    -- but a profile row must exist or there is nothing to render.
    and exists (select 1 from public.user_profiles p where p.user_id = c.id)
  -- A cheap pre-sort so the LIMIT keeps the most promising rows; the
  -- real weighted blend happens client-side in lib/suggestions.ts, which
  -- also folds in contacts and taste.
  order by coalesce(fof.mutuals, 0) desc, coalesce(cr.agree, 0) desc, c.id
  limit greatest(0, least(p_limit, 200));
$$;

revoke all on function public.get_social_suggestions(integer) from public, anon;
grant execute on function public.get_social_suggestions(integer) to authenticated;

-- Verify (as a signed-in user):
--   select * from public.get_social_suggestions(20);
