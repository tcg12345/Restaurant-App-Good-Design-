-- 056: Batched expert stats (rating + follower counts) in one round-trip.
--
-- The experts surfaces (/experts, CirclePanel) used to issue THREE requests
-- per expert — an unbounded `select *` from community_ratings just to read
-- .length, plus get_follow_counts — 3N round-trips that grew with the
-- expert roster. And like migration 052, counting user_friends through RLS
-- undercounts for everyone but the caller.
--
-- SECURITY DEFINER so the follower count aggregates over the whole
-- user_friends table; only aggregates are returned, so no edge identities
-- (who follows whom) leak past the policy.

CREATE OR REPLACE FUNCTION public.get_expert_stats(user_ids uuid[])
RETURNS TABLE (user_id uuid, rating_count bigint, follower_count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    u.uid AS user_id,
    (SELECT count(*) FROM public.community_ratings r
      WHERE r.user_id = u.uid) AS rating_count,
    (SELECT count(*) FROM public.user_friends f
      WHERE f.friend_id = u.uid AND f.status = 'accepted') AS follower_count
  FROM unnest(user_ids) AS u(uid);
$$;

REVOKE ALL ON FUNCTION public.get_expert_stats(uuid[]) FROM public;
GRANT EXECUTE ON FUNCTION public.get_expert_stats(uuid[]) TO authenticated;
