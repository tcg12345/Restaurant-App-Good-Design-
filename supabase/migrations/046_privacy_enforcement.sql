-- 046: Enforce account privacy at the database layer.
--
-- Until now privacy was client-only: community_ratings / community_photos were
-- world-readable (USING (true)), and followPublicAccount trusted the client's
-- is_public flag to insert an 'accepted' follow — so a crafted request could
-- read a private user's content or auto-follow them. This migration moves the
-- rule into RLS + a trigger.
--
-- Visibility rule (same as canViewProfile / migration 036's RPCs): a row
-- authored by U is visible to viewer V when
--   V = U (own), OR U.is_public, OR V has an ACCEPTED follow edge V→U.
--
-- Run this in your Supabase SQL Editor. Safe to run multiple times.

-- ── 1a. Visibility helper (from the VIEWER's perspective) ──
-- Takes only `target` and reads auth.uid() internally, so a caller can only
-- probe "can I see target" — which is already knowable (is_public is public;
-- their own follows are theirs to read). SECURITY DEFINER so the underlying
-- reads of user_profiles / user_friends work regardless of the caller's
-- table-level grants (an anon reading community_ratings has no need for a
-- SELECT grant on user_friends). This is why the policies below call it
-- instead of inlining the subqueries.
CREATE OR REPLACE FUNCTION public.can_view_author(target uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT target IS NOT NULL AND (
    auth.uid() = target
    OR COALESCE((SELECT p.is_public FROM public.user_profiles p WHERE p.user_id = target), false)
    OR EXISTS (SELECT 1 FROM public.user_friends f
               WHERE f.user_id = auth.uid() AND f.friend_id = target AND f.status = 'accepted')
  );
$$;
REVOKE ALL ON FUNCTION public.can_view_author(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_view_author(uuid) TO anon, authenticated, service_role;

-- ── 1b. community_ratings: replace the world-readable SELECT policy ──
DROP POLICY IF EXISTS "Anyone can read community ratings" ON public.community_ratings;
DROP POLICY IF EXISTS "Read visible community ratings" ON public.community_ratings;
CREATE POLICY "Read visible community ratings"
  ON public.community_ratings FOR SELECT
  USING (public.can_view_author(user_id));

-- ── 1c. community_photos: same rule (a private account's photos must not be
--        world-readable either — this backs up the client-side publish gate). ──
DROP POLICY IF EXISTS "Anyone can read community photos" ON public.community_photos;
DROP POLICY IF EXISTS "Read visible community photos" ON public.community_photos;
CREATE POLICY "Read visible community photos"
  ON public.community_photos FOR SELECT
  USING (public.can_view_author(user_id));

-- ── 2. Block instant-accept follows of private accounts ──
-- A follow row is (user_id = follower, friend_id = target). RLS already limits
-- INSERT to auth.uid() = user_id (the follower) and UPDATE to
-- auth.uid() = friend_id (the target approving a request). So the only way to
-- fabricate an 'accepted' edge toward someone is an INSERT by the follower —
-- gate that on the target being public (verified accounts are forced public,
-- migration 035). Pending requests and a target accepting an incoming request
-- (an UPDATE) are untouched. SECURITY DEFINER so the is_public / prior-edge
-- lookups are reliable regardless of the caller's row visibility.
CREATE OR REPLACE FUNCTION public.guard_friend_accept()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status = 'accepted' THEN
    IF NOT COALESCE((SELECT p.is_public FROM public.user_profiles p
                     WHERE p.user_id = NEW.friend_id), false)
       AND NOT EXISTS (SELECT 1 FROM public.user_friends f
                       WHERE f.user_id = NEW.user_id
                         AND f.friend_id = NEW.friend_id
                         AND f.status = 'accepted')
    THEN
      RAISE EXCEPTION 'cannot instantly follow a private account — send a request instead'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_friend_accept() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_friend_accept ON public.user_friends;
CREATE TRIGGER trg_guard_friend_accept
  BEFORE INSERT OR UPDATE ON public.user_friends
  FOR EACH ROW EXECUTE FUNCTION public.guard_friend_accept();

-- ── Note on is_expert (privacy hole #4) ──
-- Self-assignment of is_expert is ALREADY blocked server-side by
-- guard_profile_verification (migration 034/035): for non-privileged callers
-- (roles authenticated / anon) it forces is_expert = false on INSERT and
-- reverts it to OLD on UPDATE, so only service_role can grant it. No change is
-- needed here; the client toggle was already removed from ProfileSetup.
