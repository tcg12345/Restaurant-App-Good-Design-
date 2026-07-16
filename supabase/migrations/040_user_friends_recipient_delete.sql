-- 040: Let the friend_id side of a user_friends edge delete the row.
--
-- The social graph is directional: a row means `user_id` follows `friend_id`
-- (status pending/accepted/declined). The only DELETE policy (migration 002)
-- was `auth.uid() = user_id`, so a user could delete only edges they OWN as
-- the follower. Two consequences:
--   1. A private account could NEVER remove an approved follower — once you
--      accept someone, `follower→you` is their row and you had no way to
--      delete it, so they kept seeing your private content forever.
--   2. removeFriend could only ever remove one direction.
--
-- This adds a DELETE policy for the friend_id side, so the person an edge
-- points AT can also remove it. The existing user_id DELETE policy stays, so
-- a normal unfollow (delete your own outgoing edge) is unchanged.
--
-- Run this in your Supabase SQL Editor. Safe to run multiple times.

DROP POLICY IF EXISTS "Recipients can delete requests" ON public.user_friends;
CREATE POLICY "Recipients can delete requests"
  ON public.user_friends FOR DELETE
  USING (auth.uid() = friend_id);
