-- 086: Shared lists — a restaurant list several people keep together.
-- ════════════════════════════════════════════════════════════════════
-- Personal lists live in user_app_data.lists, one JSON blob per person,
-- written whole and last-writer-wins per device (ListsContext). Two people
-- editing that would clobber each other, so a shared list is its own pair
-- of tables: the list (who's in it, how it rates) and its entries (one
-- row per restaurant, so members can add and remove without touching each
-- other's rows).
--
-- Membership follows the conversations pattern (migration 037): a
-- `member_ids` array with the owner always inside it, `auth.uid() =
-- ANY(member_ids)` as the read rule. The owner is the only one who edits
-- the list row (name, emoji, mode, members); everyone in it edits entries;
-- a member leaves through leave_shared_list() because they have no UPDATE
-- on the row. Members must be the owner's mutual friends — the same rule
-- the group picker already applies — and a trigger enforces it on the
-- server so a hand-crafted request can't add strangers.
--
-- Two ways to rate, chosen per list:
--   individual — each member's own rating (their community_ratings row,
--                already readable by mutual friends under 046's RLS)
--                shows side by side. Nothing new is stored here.
--   group      — one shared score per restaurant, kept on the entry and
--                set by any member ("we gave it an 8.4").
--
-- Idempotent; safe on an already-migrated database. Run it in the Supabase
-- SQL Editor.

-- ── Tables ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.shared_lists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  emoji TEXT NOT NULL DEFAULT '👥' CHECK (char_length(emoji) BETWEEN 1 AND 8),
  rating_mode TEXT NOT NULL DEFAULT 'individual' CHECK (rating_mode IN ('individual', 'group')),
  -- Everyone in the list, owner included. Twelve is a dinner club, not a
  -- broadcast list.
  member_ids UUID[] NOT NULL DEFAULT '{}' CHECK (cardinality(member_ids) BETWEEN 1 AND 12),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_shared_lists_members ON public.shared_lists USING GIN (member_ids);

CREATE TABLE IF NOT EXISTS public.shared_list_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id UUID NOT NULL REFERENCES public.shared_lists(id) ON DELETE CASCADE,
  restaurant_id TEXT NOT NULL,
  -- A snapshot of the place so the list renders without a Places call.
  name TEXT NOT NULL DEFAULT '',
  image TEXT NOT NULL DEFAULT '',
  cuisine TEXT NOT NULL DEFAULT '',
  price TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  added_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Group mode only: the one score the list gives this place.
  group_score NUMERIC(4, 2) CHECK (group_score IS NULL OR (group_score >= 0 AND group_score <= 10)),
  group_notes TEXT NOT NULL DEFAULT '' CHECK (char_length(group_notes) <= 500),
  group_scored_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  group_scored_at TIMESTAMPTZ,
  UNIQUE (list_id, restaurant_id)
);
CREATE INDEX IF NOT EXISTS idx_shared_list_entries_list ON public.shared_list_entries(list_id, added_at);

-- ── Helpers ────────────────────────────────────────────────────────
-- "Am I in this list?" — SECURITY DEFINER so the entries policies can ask
-- without a grant on shared_lists being part of the answer, and so the two
-- tables' policies never recurse into each other.
CREATE OR REPLACE FUNCTION public.is_shared_list_member(p_list UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.shared_lists l
     WHERE l.id = p_list AND auth.uid() = ANY(l.member_ids)
  );
$$;
REVOKE ALL ON FUNCTION public.is_shared_list_member(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_shared_list_member(UUID) TO authenticated, service_role;

-- Members must be the owner, or the owner's mutual friends (both follow
-- edges accepted). Runs as a trigger so the rule holds no matter which
-- client wrote the row. SECURITY DEFINER because user_friends is RLS'd to
-- rows involving the caller and the check must see both edges regardless;
-- "privileged" is a request with no signed-in user (service role,
-- migrations), which skips the rule.
CREATE OR REPLACE FUNCTION public.guard_shared_list_members()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  privileged BOOLEAN := auth.uid() IS NULL;
  bad UUID;
BEGIN
  IF privileged THEN RETURN NEW; END IF;
  IF NOT (NEW.owner_id = ANY(NEW.member_ids)) THEN
    RAISE EXCEPTION 'The owner must stay in the list';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.owner_id <> OLD.owner_id THEN
    RAISE EXCEPTION 'A shared list cannot change owner';
  END IF;
  SELECT m INTO bad
    FROM unnest(NEW.member_ids) AS m
   WHERE m <> NEW.owner_id
     AND NOT EXISTS (
       SELECT 1 FROM public.user_friends a
        JOIN public.user_friends b ON b.user_id = a.friend_id AND b.friend_id = a.user_id
       WHERE a.user_id = NEW.owner_id AND a.friend_id = m
         AND a.status = 'accepted' AND b.status = 'accepted'
     )
   LIMIT 1;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Only mutual friends can be added to a shared list';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS shared_lists_guard_members ON public.shared_lists;
CREATE TRIGGER shared_lists_guard_members
  BEFORE INSERT OR UPDATE ON public.shared_lists
  FOR EACH ROW EXECUTE FUNCTION public.guard_shared_list_members();

-- Any change to an entry bumps the list, so "what changed since I looked"
-- is one timestamp per list.
CREATE OR REPLACE FUNCTION public.touch_shared_list()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  UPDATE public.shared_lists SET updated_at = now()
   WHERE id = COALESCE(NEW.list_id, OLD.list_id);
  RETURN COALESCE(NEW, OLD);
END;
$$;
DROP TRIGGER IF EXISTS shared_list_entries_touch ON public.shared_list_entries;
CREATE TRIGGER shared_list_entries_touch
  AFTER INSERT OR UPDATE OR DELETE ON public.shared_list_entries
  FOR EACH ROW EXECUTE FUNCTION public.touch_shared_list();

-- A member leaves. The owner can't leave (they delete instead), and no one
-- can remove anyone but themselves this way — the owner edits member_ids
-- directly.
CREATE OR REPLACE FUNCTION public.leave_shared_list(p_list UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  me UUID := auth.uid();
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  UPDATE public.shared_lists
     SET member_ids = array_remove(member_ids, me), updated_at = now()
   WHERE id = p_list AND owner_id <> me AND me = ANY(member_ids);
END;
$$;
REVOKE ALL ON FUNCTION public.leave_shared_list(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.leave_shared_list(UUID) TO authenticated;

-- ── Row level security ─────────────────────────────────────────────
ALTER TABLE public.shared_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shared_list_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can read shared lists" ON public.shared_lists;
CREATE POLICY "Members can read shared lists"
  ON public.shared_lists FOR SELECT
  USING (auth.uid() = ANY(member_ids));

DROP POLICY IF EXISTS "Owners can create shared lists" ON public.shared_lists;
CREATE POLICY "Owners can create shared lists"
  ON public.shared_lists FOR INSERT
  WITH CHECK (auth.uid() = owner_id AND auth.uid() = ANY(member_ids));

DROP POLICY IF EXISTS "Owners can update shared lists" ON public.shared_lists;
CREATE POLICY "Owners can update shared lists"
  ON public.shared_lists FOR UPDATE
  USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id AND auth.uid() = ANY(member_ids));

DROP POLICY IF EXISTS "Owners can delete shared lists" ON public.shared_lists;
CREATE POLICY "Owners can delete shared lists"
  ON public.shared_lists FOR DELETE
  USING (auth.uid() = owner_id);

DROP POLICY IF EXISTS "Members can read entries" ON public.shared_list_entries;
CREATE POLICY "Members can read entries"
  ON public.shared_list_entries FOR SELECT
  USING (public.is_shared_list_member(list_id));

DROP POLICY IF EXISTS "Members can add entries as themselves" ON public.shared_list_entries;
CREATE POLICY "Members can add entries as themselves"
  ON public.shared_list_entries FOR INSERT
  WITH CHECK (public.is_shared_list_member(list_id) AND auth.uid() = added_by);

DROP POLICY IF EXISTS "Members can update entries" ON public.shared_list_entries;
CREATE POLICY "Members can update entries"
  ON public.shared_list_entries FOR UPDATE
  USING (public.is_shared_list_member(list_id))
  WITH CHECK (public.is_shared_list_member(list_id));

DROP POLICY IF EXISTS "Members can remove entries" ON public.shared_list_entries;
CREATE POLICY "Members can remove entries"
  ON public.shared_list_entries FOR DELETE
  USING (public.is_shared_list_member(list_id));

-- ── Grants ─────────────────────────────────────────────────────────
REVOKE ALL ON public.shared_lists, public.shared_list_entries FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.shared_lists TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.shared_list_entries TO authenticated;
GRANT ALL ON public.shared_lists, public.shared_list_entries TO service_role;

-- ── Realtime ───────────────────────────────────────────────────────
-- Members watching a list see each other's adds and scores land without
-- refreshing. Adding a table already in the publication errors, hence the
-- guard.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'shared_list_entries'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.shared_list_entries;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'shared_lists'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.shared_lists;
  END IF;
EXCEPTION WHEN undefined_object THEN
  -- No realtime publication on this database; polling still works.
  NULL;
END $$;

NOTIFY pgrst, 'reload schema';

-- ── Verify ─────────────────────────────────────────────────────────
--   SELECT table_name FROM information_schema.tables
--    WHERE table_schema = 'public' AND table_name IN ('shared_lists', 'shared_list_entries');
