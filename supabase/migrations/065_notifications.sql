-- 065: Notifications — "someone liked / commented on your thing".
-- Run this in your Supabase SQL Editor.
-- ════════════════════════════════════════════════════════════════════
-- Until now engagement was write-only from the owner's point of view: a
-- friend could like your reel or leave a comment on a restaurant you
-- rated and you would never find out, because your own rating never
-- appears in your own feed. This adds the missing half.
--
-- Why triggers and not a client insert: NONE of the six engagement
-- tables stores the content owner's id — they only hold (actor,
-- content id). The recipient has to be resolved by joining the parent
-- row (community_ratings / posts / reels), and the actor is not allowed
-- to read arbitrary owners or to write rows addressed to someone else.
-- So the notification is created server-side by a SECURITY DEFINER
-- AFTER INSERT trigger, which sees the join and can write a row the
-- client never could. Clients only ever read and mark-read their own.
--
-- Self-engagement never notifies: liking your own post is not news.

-- ── 0. Preflight ─────────────────────────────────────────────────────
-- `notifications` is a name a database can easily already be carrying —
-- an abandoned experiment, a template, a half-run earlier version of
-- this file. CREATE TABLE IF NOT EXISTS would silently accept whatever
-- is there and then the index below fails with a baffling
-- 42703 "column subject_type does not exist".
--
-- So: check first. An empty table that isn't ours gets replaced. One
-- with rows in it is somebody's data — stop, and say exactly what to do
-- about it, rather than dropping it or limping on half-migrated.

DO $$
DECLARE
  v_kind "char";
  v_rows BIGINT;
BEGIN
  IF to_regclass('public.notifications') IS NULL THEN
    RETURN;  -- nothing there: the CREATE TABLE below does the work
  END IF;

  SELECT c.relkind INTO v_kind
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'notifications';

  IF v_kind <> 'r' THEN
    RAISE EXCEPTION
      'public.notifications already exists as a % (not a table). Rename or remove it, then re-run this migration.',
      CASE v_kind WHEN 'v' THEN 'view' WHEN 'm' THEN 'materialized view'
                  WHEN 'f' THEN 'foreign table' WHEN 'p' THEN 'partitioned table'
                  -- The cast is load-bearing: "char" || unknown is ambiguous.
                  ELSE 'relation of kind ' || v_kind::text END;
  END IF;

  -- Already ours (or a partial run of this file) — section 1 heals it.
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
     WHERE attrelid = 'public.notifications'::regclass
       AND attname = 'subject_type' AND NOT attisdropped
  ) THEN
    RETURN;
  END IF;

  EXECUTE 'SELECT count(*) FROM public.notifications' INTO v_rows;
  IF v_rows > 0 THEN
    RAISE EXCEPTION
      'public.notifications already exists with a different shape and % row(s) of data. This migration will not touch it. Rename it (ALTER TABLE public.notifications RENAME TO notifications_legacy;) and re-run.',
      v_rows;
  END IF;

  -- Empty and not ours. No CASCADE on purpose: if something genuinely
  -- depends on it, fail loudly instead of taking the dependents down.
  RAISE NOTICE 'Replacing an empty, unrelated public.notifications table.';
  DROP TABLE public.notifications;
END $$;

-- ── 1. Table ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The recipient: whoever owns the post / reel / rating.
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Who did the thing.
  actor_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  kind TEXT NOT NULL CHECK (kind IN ('like', 'comment')),
  subject_type TEXT NOT NULL CHECK (subject_type IN ('post', 'reel', 'rating')),
  subject_id UUID NOT NULL,

  -- Denormalized so the notification list renders in one query and
  -- still reads correctly after the subject is edited or deleted.
  subject_label TEXT NOT NULL DEFAULT '',   -- restaurant name, or a caption excerpt
  preview TEXT NOT NULL DEFAULT '',         -- the comment text, trimmed
  -- Set for rating subjects (and for posts that are a shared rating) so
  -- tapping the row can land on the restaurant page.
  restaurant_id TEXT,
  comment_id UUID,

  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Heal a table left behind by a partial run of an earlier version of
-- this file: CREATE TABLE IF NOT EXISTS adds nothing to a table that
-- already exists, so each column is also stated on its own.
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS subject_label TEXT NOT NULL DEFAULT '';
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS preview TEXT NOT NULL DEFAULT '';
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS restaurant_id TEXT;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS comment_id UUID;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;

-- The list view: newest first, scoped to one recipient.
CREATE INDEX IF NOT EXISTS notifications_user_created_idx
  ON public.notifications (user_id, created_at DESC);
-- The unread badge.
CREATE INDEX IF NOT EXISTS notifications_unread_idx
  ON public.notifications (user_id) WHERE read_at IS NULL;
-- Comments on a rating, read from the restaurant page.
CREATE INDEX IF NOT EXISTS notifications_subject_idx
  ON public.notifications (subject_type, subject_id, created_at DESC);

-- One like row per (recipient, actor, subject): un-liking and re-liking
-- refreshes the existing notification instead of stacking duplicates.
-- Comments are deliberately NOT deduped — each one is its own thing to
-- read.
CREATE UNIQUE INDEX IF NOT EXISTS notifications_like_unique_idx
  ON public.notifications (user_id, actor_id, subject_type, subject_id)
  WHERE kind = 'like';

-- ── 2. RLS: your notifications, nobody else's ────────────────────────
-- There is no INSERT policy on purpose. Every row is written by the
-- DEFINER triggers below; a client that could insert directly could
-- forge "Alice liked your post".

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own notifications" ON public.notifications;
DROP POLICY IF EXISTS "Users can update own notifications" ON public.notifications;
DROP POLICY IF EXISTS "Users can delete own notifications" ON public.notifications;

CREATE POLICY "Users can read own notifications"
  ON public.notifications FOR SELECT USING (auth.uid() = user_id);
-- Update exists only so the client can stamp read_at.
CREATE POLICY "Users can update own notifications"
  ON public.notifications FOR UPDATE USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own notifications"
  ON public.notifications FOR DELETE USING (auth.uid() = user_id);

-- ── 3. The writer ────────────────────────────────────────────────────
-- Shared by all six triggers. Not granted to anon/authenticated: the
-- only callers are the trigger functions, which run as the definer.

CREATE OR REPLACE FUNCTION public.push_notification(
  p_user_id UUID,
  p_actor_id UUID,
  p_kind TEXT,
  p_subject_type TEXT,
  p_subject_id UUID,
  p_subject_label TEXT,
  p_preview TEXT,
  p_restaurant_id TEXT,
  p_comment_id UUID
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Deleted parent, or you engaging with your own thing: nothing to say.
  IF p_user_id IS NULL OR p_actor_id IS NULL OR p_user_id = p_actor_id THEN
    RETURN;
  END IF;

  IF p_kind = 'like' THEN
    INSERT INTO public.notifications
      (user_id, actor_id, kind, subject_type, subject_id, subject_label, preview, restaurant_id, comment_id)
    VALUES
      (p_user_id, p_actor_id, 'like', p_subject_type, p_subject_id,
       COALESCE(p_subject_label, ''), '', p_restaurant_id, NULL)
    ON CONFLICT (user_id, actor_id, subject_type, subject_id) WHERE kind = 'like'
    DO UPDATE SET
      created_at = now(),
      read_at = NULL,
      subject_label = EXCLUDED.subject_label,
      restaurant_id = EXCLUDED.restaurant_id;
  ELSE
    INSERT INTO public.notifications
      (user_id, actor_id, kind, subject_type, subject_id, subject_label, preview, restaurant_id, comment_id)
    VALUES
      (p_user_id, p_actor_id, 'comment', p_subject_type, p_subject_id,
       COALESCE(p_subject_label, ''), left(COALESCE(p_preview, ''), 280), p_restaurant_id, p_comment_id);
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.push_notification(UUID, UUID, TEXT, TEXT, UUID, TEXT, TEXT, TEXT, UUID)
  FROM PUBLIC, anon, authenticated;

-- ── 4. Triggers: ratings ─────────────────────────────────────────────
-- These are the ones the app had no way of showing at all — a comment
-- left on a rating in someone's feed was invisible to the person who
-- wrote the rating.
--
-- Every trigger below FAILS OPEN. An AFTER INSERT trigger that raises
-- takes the whole statement down with it, which would mean a broken
-- notification stops the like or comment from being saved at all — the
-- side effect killing the user's actual action. Losing a notification
-- is a nuisance; losing the comment is not acceptable. The reply
-- branches matter most here: they read `parent_id`, which only exists
-- once migrations 024 and 057 have been applied.

CREATE OR REPLACE FUNCTION public.notify_activity_like()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_owner UUID;
  v_name TEXT;
  v_place TEXT;
BEGIN
  BEGIN
    SELECT r.user_id, r.restaurant_name, r.restaurant_id
      INTO v_owner, v_name, v_place
      FROM public.community_ratings r WHERE r.id = NEW.rating_id;
    PERFORM public.push_notification(
      v_owner, NEW.user_id, 'like', 'rating', NEW.rating_id, v_name, '', v_place, NULL);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[notify_activity_like] skipped: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_activity_like ON public.activity_likes;
CREATE TRIGGER trg_notify_activity_like
  AFTER INSERT ON public.activity_likes
  FOR EACH ROW EXECUTE FUNCTION public.notify_activity_like();

CREATE OR REPLACE FUNCTION public.notify_activity_comment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_owner UUID;
  v_name TEXT;
  v_place TEXT;
BEGIN
  BEGIN
    SELECT r.user_id, r.restaurant_name, r.restaurant_id
      INTO v_owner, v_name, v_place
      FROM public.community_ratings r WHERE r.id = NEW.rating_id;
    PERFORM public.push_notification(
      v_owner, NEW.user_id, 'comment', 'rating', NEW.rating_id, v_name, NEW.text, v_place, NEW.id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[notify_activity_comment] skipped: %', SQLERRM;
  END;

  -- A reply also pings the person being replied to, when that is
  -- somebody other than the rating's owner. Its own block, so a missing
  -- parent_id column can't roll back the notification above.
  BEGIN
    IF NEW.parent_id IS NOT NULL THEN
      SELECT c.user_id INTO v_owner
        FROM public.activity_comments c WHERE c.id = NEW.parent_id;
      PERFORM public.push_notification(
        v_owner, NEW.user_id, 'comment', 'rating', NEW.rating_id, v_name, NEW.text, v_place, NEW.id);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[notify_activity_comment] reply ping skipped: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_activity_comment ON public.activity_comments;
CREATE TRIGGER trg_notify_activity_comment
  AFTER INSERT ON public.activity_comments
  FOR EACH ROW EXECUTE FUNCTION public.notify_activity_comment();

-- ── 5. Triggers: posts ───────────────────────────────────────────────
-- A post that is a shared rating (posts.rating_id, migration 064)
-- carries the restaurant through, so the row routes like a rating.
--
-- That enrichment is a SEPARATE step from resolving the owner, and
-- deliberately so: joining posts to community_ratings in one query makes
-- the whole notification depend on migration 064 having been applied,
-- and on a deployment still on 063 every post like and comment would
-- silently produce nothing.

CREATE OR REPLACE FUNCTION public.notify_post_like()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_owner UUID;
  v_label TEXT;
  v_place TEXT;
  v_rname TEXT;
  v_rplace TEXT;
BEGIN
  BEGIN
    SELECT p.user_id, COALESCE(p.caption, '') INTO v_owner, v_label
      FROM public.posts p WHERE p.id = NEW.post_id;

    -- Optional, and only meaningful once 064 has landed.
    BEGIN
      SELECT NULLIF(r.restaurant_name, ''), r.restaurant_id
        INTO v_rname, v_rplace
        FROM public.posts p
        JOIN public.community_ratings r ON r.id = p.rating_id
        WHERE p.id = NEW.post_id;
      -- Guarded by FOUND: an ordinary post has no rating_id, the join
      -- returns nothing, and SELECT INTO would otherwise NULL out the
      -- caption we just resolved.
      IF FOUND THEN
        v_label := COALESCE(v_rname, v_label);
        v_place := v_rplace;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      NULL;  -- no rating link on this deployment; the caption still works
    END;

    PERFORM public.push_notification(
      v_owner, NEW.user_id, 'like', 'post', NEW.post_id, v_label, '', v_place, NULL);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[notify_post_like] skipped: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_post_like ON public.post_likes;
CREATE TRIGGER trg_notify_post_like
  AFTER INSERT ON public.post_likes
  FOR EACH ROW EXECUTE FUNCTION public.notify_post_like();

CREATE OR REPLACE FUNCTION public.notify_post_comment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_owner UUID;
  v_label TEXT;
  v_place TEXT;
  v_rname TEXT;
  v_rplace TEXT;
BEGIN
  BEGIN
    SELECT p.user_id, COALESCE(p.caption, '') INTO v_owner, v_label
      FROM public.posts p WHERE p.id = NEW.post_id;

    BEGIN
      SELECT NULLIF(r.restaurant_name, ''), r.restaurant_id
        INTO v_rname, v_rplace
        FROM public.posts p
        JOIN public.community_ratings r ON r.id = p.rating_id
        WHERE p.id = NEW.post_id;
      -- Guarded by FOUND: an ordinary post has no rating_id, the join
      -- returns nothing, and SELECT INTO would otherwise NULL out the
      -- caption we just resolved.
      IF FOUND THEN
        v_label := COALESCE(v_rname, v_label);
        v_place := v_rplace;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      NULL;  -- see notify_post_like
    END;

    PERFORM public.push_notification(
      v_owner, NEW.user_id, 'comment', 'post', NEW.post_id, v_label, NEW.body, v_place, NEW.id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[notify_post_comment] skipped: %', SQLERRM;
  END;

  BEGIN
    IF NEW.parent_id IS NOT NULL THEN
      SELECT c.user_id INTO v_owner
        FROM public.post_comments c WHERE c.id = NEW.parent_id;
      PERFORM public.push_notification(
        v_owner, NEW.user_id, 'comment', 'post', NEW.post_id, v_label, NEW.body, v_place, NEW.id);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[notify_post_comment] reply ping skipped: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_post_comment ON public.post_comments;
CREATE TRIGGER trg_notify_post_comment
  AFTER INSERT ON public.post_comments
  FOR EACH ROW EXECUTE FUNCTION public.notify_post_comment();

-- ── 6. Triggers: reels ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.notify_reel_like()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_owner UUID;
  v_label TEXT;
BEGIN
  BEGIN
    SELECT e.user_id, e.caption INTO v_owner, v_label
      FROM public.reels e WHERE e.id = NEW.reel_id;
    PERFORM public.push_notification(
      v_owner, NEW.user_id, 'like', 'reel', NEW.reel_id, v_label, '', NULL, NULL);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[notify_reel_like] skipped: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_reel_like ON public.reel_likes;
CREATE TRIGGER trg_notify_reel_like
  AFTER INSERT ON public.reel_likes
  FOR EACH ROW EXECUTE FUNCTION public.notify_reel_like();

CREATE OR REPLACE FUNCTION public.notify_reel_comment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_owner UUID;
  v_label TEXT;
BEGIN
  BEGIN
    SELECT e.user_id, e.caption INTO v_owner, v_label
      FROM public.reels e WHERE e.id = NEW.reel_id;
    PERFORM public.push_notification(
      v_owner, NEW.user_id, 'comment', 'reel', NEW.reel_id, v_label, NEW.body, NULL, NEW.id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[notify_reel_comment] skipped: %', SQLERRM;
  END;

  BEGIN
    IF NEW.parent_id IS NOT NULL THEN
      SELECT c.user_id INTO v_owner
        FROM public.reel_comments c WHERE c.id = NEW.parent_id;
      PERFORM public.push_notification(
        v_owner, NEW.user_id, 'comment', 'reel', NEW.reel_id, v_label, NEW.body, NULL, NEW.id);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[notify_reel_comment] reply ping skipped: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_reel_comment ON public.reel_comments;
CREATE TRIGGER trg_notify_reel_comment
  AFTER INSERT ON public.reel_comments
  FOR EACH ROW EXECUTE FUNCTION public.notify_reel_comment();

-- ── 7. Un-liking retracts an unread like ─────────────────────────────
-- A stray double-tap that gets undone a second later should not leave a
-- permanent "X liked your post" the owner never saw. Once it HAS been
-- seen (read_at set) the row stays — silently deleting something the
-- user already read is worse than a stale line.

CREATE OR REPLACE FUNCTION public.retract_like_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_subject_type TEXT := TG_ARGV[0];
  v_subject_id UUID;
BEGIN
  -- IF/ELSIF, not a CASE expression: plpgsql hands a CASE to the executor
  -- as ONE expression and resolves every arm's parameters up front, so
  -- `OLD.post_id` would be looked up even on activity_likes — where that
  -- column doesn't exist — and the whole retraction would fail. Separate
  -- statements are compiled lazily, so only the taken branch is touched.
  --
  -- Fails open like the insert triggers: un-liking must succeed even if
  -- the retraction can't.
  BEGIN
    IF v_subject_type = 'rating' THEN
      v_subject_id := OLD.rating_id;
    ELSIF v_subject_type = 'post' THEN
      v_subject_id := OLD.post_id;
    ELSE
      v_subject_id := OLD.reel_id;
    END IF;
    DELETE FROM public.notifications
      WHERE kind = 'like'
        AND actor_id = OLD.user_id
        AND subject_type = v_subject_type
        AND subject_id = v_subject_id
        AND read_at IS NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[retract_like_notification] skipped: %', SQLERRM;
  END;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_retract_activity_like ON public.activity_likes;
CREATE TRIGGER trg_retract_activity_like
  AFTER DELETE ON public.activity_likes
  FOR EACH ROW EXECUTE FUNCTION public.retract_like_notification('rating');

DROP TRIGGER IF EXISTS trg_retract_post_like ON public.post_likes;
CREATE TRIGGER trg_retract_post_like
  AFTER DELETE ON public.post_likes
  FOR EACH ROW EXECUTE FUNCTION public.retract_like_notification('post');

DROP TRIGGER IF EXISTS trg_retract_reel_like ON public.reel_likes;
CREATE TRIGGER trg_retract_reel_like
  AFTER DELETE ON public.reel_likes
  FOR EACH ROW EXECUTE FUNCTION public.retract_like_notification('reel');

-- ── 8. Live delivery ─────────────────────────────────────────────────
-- postgres_changes enforces RLS per subscriber, so each client only
-- receives rows addressed to them.

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
EXCEPTION
  WHEN undefined_object THEN NULL;  -- publication absent (non-Supabase env)
  WHEN duplicate_object THEN NULL;  -- already added (safe re-run)
END $$;

COMMENT ON TABLE public.notifications IS
  'In-app notifications. Written only by SECURITY DEFINER triggers on the engagement tables; clients read and mark-read their own rows.';
