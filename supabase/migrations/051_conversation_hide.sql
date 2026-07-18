-- 051: Per-user conversation hide.
--
-- "Delete conversation" used to DELETE the conversations row (messages
-- cascade), so ANY member of a group chat erased history for ALL
-- participants — and everyone else kept a stale copy until reload because
-- realtime only subscribes to message INSERTs. Deletion is now per-user:
-- hiding appends the caller to hidden_by; the row (and everyone else's
-- history) survives.

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS hidden_by uuid[] NOT NULL DEFAULT '{}';

-- Atomic hide/unhide — array_append/array_remove server-side so two
-- participants hiding at once can't clobber each other with a
-- read-modify-write. SECURITY INVOKER: the participants-only UPDATE policy
-- from migration 037 still applies, and the WHERE re-checks membership.
CREATE OR REPLACE FUNCTION public.set_conversation_hidden(conv uuid, hide boolean)
RETURNS void
LANGUAGE sql
SET search_path = public
AS $$
  UPDATE public.conversations
     SET hidden_by = CASE WHEN hide
       THEN array_append(array_remove(hidden_by, auth.uid()), auth.uid())
       ELSE array_remove(hidden_by, auth.uid())
     END
   WHERE id = conv
     AND auth.uid() = ANY(participant_ids);
$$;

REVOKE ALL ON FUNCTION public.set_conversation_hidden(uuid, boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.set_conversation_hidden(uuid, boolean) TO authenticated;

-- Hard deletes become garbage collection only: allowed when EVERY
-- participant has hidden the conversation (nobody loses history they can
-- still see). The old policy let any single participant destroy it.
DROP POLICY IF EXISTS "Participants can delete conversations" ON public.conversations;
CREATE POLICY "Participants can delete fully-hidden conversations"
  ON public.conversations FOR DELETE
  USING (auth.uid() = ANY(participant_ids) AND participant_ids <@ hidden_by);
