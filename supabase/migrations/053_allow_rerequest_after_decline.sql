-- 053: Let a declined follow request be sent again.
--
-- declineFriendRequest UPDATEs the row to status='declined' — but the row
-- survives under UNIQUE(user_id, friend_id), and sendFriendRequest was a
-- plain INSERT: once a target declined, the requester's every retry hit
-- 23505 forever ("Couldn't send that request. Try again."). The client now
-- upserts the outgoing row back to 'pending', which needs an UPDATE policy
-- for the REQUESTER's side — migration 004 only allowed friend_id (the
-- incoming side) to update.
--
-- Scope note: WITH CHECK mirrors the existing INSERT latitude (the
-- requester already writes rows for their own user_id, including
-- status='accepted' for public-account follows), so this widens nothing.

DROP POLICY IF EXISTS "Users can update outgoing requests" ON public.user_friends;
CREATE POLICY "Users can update outgoing requests"
  ON public.user_friends FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
