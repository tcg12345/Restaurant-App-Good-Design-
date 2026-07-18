-- 052: Follower/following counts that survive RLS.
--
-- The user_friends SELECT policy (migration 004) only exposes rows where
-- the CALLER is user_id or friend_id, and RLS filters BEFORE aggregation —
-- so count queries against anyone else's id returned 0-or-1: every other
-- user's profile showed bogus follower counts and every expert showed ~0.
--
-- SECURITY DEFINER lets the function count over the whole table; it
-- returns ONLY the two aggregates, so no edge identities (who follows
-- whom) leak past the policy.

CREATE OR REPLACE FUNCTION public.get_follow_counts(target uuid)
RETURNS TABLE (followers bigint, following bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    (SELECT count(*) FROM public.user_friends
      WHERE friend_id = target AND status = 'accepted') AS followers,
    (SELECT count(*) FROM public.user_friends
      WHERE user_id = target AND status = 'accepted') AS following;
$$;

REVOKE ALL ON FUNCTION public.get_follow_counts(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_follow_counts(uuid) TO authenticated;
