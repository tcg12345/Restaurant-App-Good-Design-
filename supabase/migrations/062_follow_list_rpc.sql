-- 062: Follower / following USER LISTS for any viewable profile.
--
-- The user_friends SELECT policy only exposes rows involving the CALLER,
-- so the client can list followers/following for itself but for nobody
-- else (other profiles only ever showed the aggregate counts via
-- get_follow_counts, migration 052). The full-page follower/following
-- lists on profiles need the actual ids behind those counts.
--
-- SECURITY DEFINER lets the function read the whole edge table, but it
-- returns rows ONLY when the caller may view the target's content at
-- all — public account, self, or an accepted follow edge caller→target
-- (can_view_user_content, migration 036: the same rule every other
-- profile-data RPC applies). Private accounts' graphs stay hidden.
--
-- Only user ids leave the database; the client resolves them against
-- user_profiles (already readable) for names / verified badges.

CREATE OR REPLACE FUNCTION public.get_follow_list(target uuid, direction text)
RETURNS TABLE (other_user_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE WHEN direction = 'followers' THEN f.user_id ELSE f.friend_id END
  FROM public.user_friends f
  WHERE f.status = 'accepted'
    AND ((direction = 'followers' AND f.friend_id = target)
      OR (direction = 'following' AND f.user_id  = target))
    AND public.can_view_user_content(auth.uid(), target)
  ORDER BY f.created_at DESC;
$$;

-- anon included: public profiles are viewable logged-out (see
-- UserProfile.tsx canView), and can_view_user_content(NULL, target)
-- already restricts anon to public accounts only.
REVOKE ALL ON FUNCTION public.get_follow_list(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_follow_list(uuid, text) TO anon, authenticated, service_role;
