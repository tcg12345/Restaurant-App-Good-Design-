-- A sender may request a private follow, but only the recipient can approve it.
-- Keep this restrictive so any surviving permissive INSERT policy cannot bypass it.
DROP POLICY IF EXISTS "Follow inserts require consent" ON public.user_friends;
CREATE POLICY "Follow inserts require consent" ON public.user_friends
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND friend_id <> user_id
    AND (
      status = 'pending'
      OR (
        status = 'accepted'
        AND EXISTS (
          SELECT 1 FROM public.user_profiles p
          WHERE p.user_id = friend_id AND (p.is_public OR p.is_verified)
        )
      )
    )
  );
