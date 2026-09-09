-- Durable conversation changes and participant-only ephemeral activity.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'conversations'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;
  END IF;
END $$;

CREATE POLICY "Chat participants receive activity"
ON realtime.messages FOR SELECT TO authenticated
USING (
  extension = 'broadcast' AND EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE (SELECT auth.uid()) = ANY(c.participant_ids)
      AND split_part((SELECT realtime.topic()), ':', 3) = ANY(c.participant_ids::text[])
      AND (SELECT realtime.topic()) = 'chat-activity:' || c.id::text || ':' || split_part((SELECT realtime.topic()), ':', 3)
  )
);

CREATE POLICY "Chat participants publish own activity"
ON realtime.messages FOR INSERT TO authenticated
WITH CHECK (
  extension = 'broadcast' AND EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE (SELECT auth.uid()) = ANY(c.participant_ids)
      AND (SELECT realtime.topic()) = 'chat-activity:' || c.id::text || ':' || (SELECT auth.uid())::text
  )
);
