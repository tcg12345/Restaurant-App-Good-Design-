-- ── Read receipts ────────────────────────────────────────────────────────
-- The Messages UI wants to show "Read" under the sender's last message, but
-- migration 037 scoped conversation_reads SELECT to the row's owner — a
-- sender could never see when the OTHER participant read. Widen SELECT to
-- all participants of the conversation (write policies unchanged: you still
-- only ever insert/update your own read row), and stream changes so the
-- label flips live.

DROP POLICY IF EXISTS "Users can read own read state" ON public.conversation_reads;
DROP POLICY IF EXISTS "Participants can read read state" ON public.conversation_reads;
CREATE POLICY "Participants can read read state"
  ON public.conversation_reads FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id = conversation_id AND auth.uid() = ANY(c.participant_ids)));

-- Realtime: postgres_changes enforces RLS per subscriber, so participants
-- receive each other's read-row INSERTs/UPDATEs and nobody else's.
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.conversation_reads;
EXCEPTION
  WHEN undefined_object THEN NULL;  -- publication absent (non-Supabase env)
  WHEN duplicate_object THEN NULL;  -- already added (safe re-run)
END $$;
