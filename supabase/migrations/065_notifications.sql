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
  SELECT r.user_id, r.restaurant_name, r.restaurant_id
    INTO v_owner, v_name, v_place
    FROM public.community_ratings r WHERE r.id = NEW.rating_id;
  PERFORM public.push_notification(
    v_owner, NEW.user_id, 'like', 'rating', NEW.rating_id, v_name, '', v_place, NULL);
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
  SELECT r.user_id, r.restaurant_name, r.restaurant_id
    INTO v_owner, v_name, v_place
    FROM public.community_ratings r WHERE r.id = NEW.rating_id;
  PERFORM public.push_notification(
    v_owner, NEW.user_id, 'comment', 'rating', NEW.rating_id, v_name, NEW.text, v_place, NEW.id);

  -- A reply also pings the person being replied to, when that is
  -- somebody other than the rating's owner.
  IF NEW.parent_id IS NOT NULL THEN
    SELECT c.user_id INTO v_owner
      FROM public.activity_comments c WHERE c.id = NEW.parent_id;
    PERFORM public.push_notification(
      v_owner, NEW.user_id, 'comment', 'rating', NEW.rating_id, v_name, NEW.text, v_place, NEW.id);
  END IF;
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
BEGIN
  SELECT p.user_id,
         COALESCE(NULLIF(r.restaurant_name, ''), p.caption, ''),
         r.restaurant_id
    INTO v_owner, v_label, v_place
    FROM public.posts p
    LEFT JOIN public.community_ratings r ON r.id = p.rating_id
    WHERE p.id = NEW.post_id;
  PERFORM public.push_notification(
    v_owner, NEW.user_id, 'like', 'post', NEW.post_id, v_label, '', v_place, NULL);
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
BEGIN
  SELECT p.user_id,
         COALESCE(NULLIF(r.restaurant_name, ''), p.caption, ''),
         r.restaurant_id
    INTO v_owner, v_label, v_place
    FROM public.posts p
    LEFT JOIN public.community_ratings r ON r.id = p.rating_id
    WHERE p.id = NEW.post_id;
  PERFORM public.push_notification(
    v_owner, NEW.user_id, 'comment', 'post', NEW.post_id, v_label, NEW.body, v_place, NEW.id);

  IF NEW.parent_id IS NOT NULL THEN
    SELECT c.user_id INTO v_owner
      FROM public.post_comments c WHERE c.id = NEW.parent_id;
    PERFORM public.push_notification(
      v_owner, NEW.user_id, 'comment', 'post', NEW.post_id, v_label, NEW.body, v_place, NEW.id);
  END IF;
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
  SELECT e.user_id, e.caption INTO v_owner, v_label
    FROM public.reels e WHERE e.id = NEW.reel_id;
  PERFORM public.push_notification(
    v_owner, NEW.user_id, 'like', 'reel', NEW.reel_id, v_label, '', NULL, NULL);
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
  SELECT e.user_id, e.caption INTO v_owner, v_label
    FROM public.reels e WHERE e.id = NEW.reel_id;
  PERFORM public.push_notification(
    v_owner, NEW.user_id, 'comment', 'reel', NEW.reel_id, v_label, NEW.body, NULL, NEW.id);

  IF NEW.parent_id IS NOT NULL THEN
    SELECT c.user_id INTO v_owner
      FROM public.reel_comments c WHERE c.id = NEW.parent_id;
    PERFORM public.push_notification(
      v_owner, NEW.user_id, 'comment', 'reel', NEW.reel_id, v_label, NEW.body, NULL, NEW.id);
  END IF;
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
  v_subject_id := CASE v_subject_type
    WHEN 'rating' THEN OLD.rating_id
    WHEN 'post' THEN OLD.post_id
    ELSE OLD.reel_id
  END;
  DELETE FROM public.notifications
    WHERE kind = 'like'
      AND actor_id = OLD.user_id
      AND subject_type = v_subject_type
      AND subject_id = v_subject_id
      AND read_at IS NULL;
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
