-- 037: Real messaging tables.
--
-- Until now "Messages" was a single-player illusion: conversations were
-- saved only into the SENDER's own user_app_data row (chats/chats_read
-- JSONB), so nothing was ever delivered to the other participant. This
-- migration creates shared tables with participant-scoped RLS and enables
-- realtime on messages so recipients see new messages without refreshing.
--
--   conversations       — one row per chat (1:1 or group)
--   messages            — immutable; INSERT only, sender must be auth.uid()
--   conversation_reads  — per-(conversation, user) last-read timestamp,
--                         each user upserts only their own row (no races)
--
-- Visibility rule everywhere: auth.uid() = ANY(participant_ids).
--
-- Run this in your Supabase SQL Editor.

-- ── Guard: move aside incompatible pre-existing tables ──────────────────
-- Some databases already contain tables named conversations / messages /
-- conversation_reads with a different shape (the app itself never used
-- these names before this migration). CREATE TABLE IF NOT EXISTS would
-- silently keep the old shape and every later statement referencing our
-- columns would fail (42703: column "conversation_id" does not exist).
-- Rename such tables out of the way — non-destructive; inspect them with
--   SELECT * FROM information_schema.columns
--   WHERE table_name LIKE '%_legacy_pre037';
-- and drop them once confirmed junk.
DO $$
BEGIN
  IF to_regclass('public.conversations') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'conversations' AND column_name = 'participant_ids')
  THEN
    ALTER TABLE public.conversations RENAME TO conversations_legacy_pre037;
  END IF;
  IF to_regclass('public.messages') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'messages' AND column_name = 'conversation_id')
  THEN
    ALTER TABLE public.messages RENAME TO messages_legacy_pre037;
  END IF;
  IF to_regclass('public.conversation_reads') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'conversation_reads' AND column_name = 'conversation_id')
  THEN
    ALTER TABLE public.conversation_reads RENAME TO conversation_reads_legacy_pre037;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_ids uuid[] NOT NULL CHECK (cardinality(participant_ids) BETWEEN 1 AND 100),
  is_group boolean NOT NULL DEFAULT false,
  name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Maintained by the trigger below on every message insert; clients cannot
  -- write it directly (column-level UPDATE grant covers name only).
  last_message_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  text text NOT NULL DEFAULT '',
  -- Rich share card ({ sharedRestaurant | sharedRecipe | sharedReel |
  -- sharedPost | sharedGuide } — see SharePayload in ChatContext.tsx).
  shared_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.conversation_reads (
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  last_read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_created
  ON public.messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_conversations_participants
  ON public.conversations USING GIN (participant_ids);
CREATE INDEX IF NOT EXISTS idx_conversations_last_message
  ON public.conversations(last_message_at DESC);

-- ── RLS ─────────────────────────────────────────────────────────────────
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_reads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Participants can read conversations" ON public.conversations;
CREATE POLICY "Participants can read conversations"
  ON public.conversations FOR SELECT
  USING (auth.uid() = ANY(participant_ids));

DROP POLICY IF EXISTS "Participants can create conversations" ON public.conversations;
CREATE POLICY "Participants can create conversations"
  ON public.conversations FOR INSERT
  WITH CHECK (auth.uid() = ANY(participant_ids));

-- UPDATE is limited to the group name by the column grant below.
DROP POLICY IF EXISTS "Participants can update conversations" ON public.conversations;
CREATE POLICY "Participants can update conversations"
  ON public.conversations FOR UPDATE
  USING (auth.uid() = ANY(participant_ids));

DROP POLICY IF EXISTS "Participants can delete conversations" ON public.conversations;
CREATE POLICY "Participants can delete conversations"
  ON public.conversations FOR DELETE
  USING (auth.uid() = ANY(participant_ids));

DROP POLICY IF EXISTS "Participants can read messages" ON public.messages;
CREATE POLICY "Participants can read messages"
  ON public.messages FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id = conversation_id AND auth.uid() = ANY(c.participant_ids)));

DROP POLICY IF EXISTS "Participants can send messages as themselves" ON public.messages;
CREATE POLICY "Participants can send messages as themselves"
  ON public.messages FOR INSERT
  WITH CHECK (
    sender_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = conversation_id AND auth.uid() = ANY(c.participant_ids)));

-- Read receipts: each user manages only their own row, and only for
-- conversations they belong to.
DROP POLICY IF EXISTS "Users can read own read state" ON public.conversation_reads;
CREATE POLICY "Users can read own read state"
  ON public.conversation_reads FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can insert own read state" ON public.conversation_reads;
CREATE POLICY "Users can insert own read state"
  ON public.conversation_reads FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = conversation_id AND auth.uid() = ANY(c.participant_ids)));

DROP POLICY IF EXISTS "Users can update own read state" ON public.conversation_reads;
CREATE POLICY "Users can update own read state"
  ON public.conversation_reads FOR UPDATE
  USING (user_id = auth.uid());

-- ── Grants ──────────────────────────────────────────────────────────────
-- Neutralize Supabase's permissive default privileges, then grant exactly
-- what the app needs (RLS remains the row-level gate). Messaging requires
-- a signed-in user; messages are immutable (no UPDATE/DELETE — removing a
-- conversation cascades); conversations accept UPDATE on the group name
-- only, so participant_ids / last_message_at can't be tampered with.
REVOKE ALL ON public.conversations, public.messages, public.conversation_reads FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.conversations TO authenticated;
GRANT UPDATE (name) ON public.conversations TO authenticated;
GRANT SELECT, INSERT ON public.messages TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.conversation_reads TO authenticated;
GRANT ALL ON public.conversations, public.messages, public.conversation_reads TO service_role;

-- ── last_message_at maintenance ─────────────────────────────────────────
-- SECURITY DEFINER because clients have no UPDATE grant on the column.
CREATE OR REPLACE FUNCTION public.bump_conversation_last_message()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  UPDATE public.conversations
    SET last_message_at = NEW.created_at
    WHERE id = NEW.conversation_id AND last_message_at < NEW.created_at;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.bump_conversation_last_message() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_messages_bump_conversation ON public.messages;
CREATE TRIGGER trg_messages_bump_conversation
  AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.bump_conversation_last_message();

-- ── Realtime ────────────────────────────────────────────────────────────
-- postgres_changes subscriptions enforce RLS per subscriber, so a client
-- only receives INSERTs for messages in its own conversations.
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
EXCEPTION
  WHEN undefined_object THEN NULL;  -- publication absent (non-Supabase env)
  WHEN duplicate_object THEN NULL;  -- already added (safe re-run)
END $$;
