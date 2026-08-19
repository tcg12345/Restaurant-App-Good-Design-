-- 069: Cuisine edits become suggestions, reviewed before anyone sees them.
-- ════════════════════════════════════════════════════════════════════
-- Migration 068 let any signed-in user write the top tier of
-- restaurant_cuisine directly. That is a vandalism vector and it was
-- wrong: one person could relabel any restaurant for everybody, silently
-- and instantly, with nothing to review it and no way to notice.
--
-- Editing is now a proposal, not a write:
--
--   • A user suggests a cuisine. It changes nothing they can see and
--     nothing anyone else can see. One live suggestion per person per
--     restaurant, so nobody can stuff the ballot.
--   • An admin approves it → applied at the top of the ranking, above
--     Michelin and Google, which is what makes a correction stick.
--   • OR enough independent people suggest the SAME cuisine
--     (AUTO_APPLY_VOTES below) → applied without waiting for review,
--     because that many strangers agreeing is a better signal than one
--     reviewer's guess. Admins are notified either way.
--
-- The `user` source is removed from the ranking rather than merely
-- unused: a client build that still sends it now scores 0 and its write
-- is dropped by 068's guard. There is no version of the app that can
-- write a cuisine everyone sees without going through this file.
--
-- Run AFTER 065 (notifications) and 068 (restaurant_cuisine).

-- ── 0. Preconditions ─────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.restaurant_cuisine') IS NULL THEN
    RAISE EXCEPTION 'public.restaurant_cuisine is missing — run 068_restaurant_cuisine.sql first.';
  END IF;
  IF to_regclass('public.notifications') IS NULL THEN
    RAISE EXCEPTION 'public.notifications is missing — run 065_notifications.sql first.';
  END IF;
  IF to_regclass('public.app_admins') IS NULL THEN
    RAISE EXCEPTION 'public.app_admins is missing — run 034_verified_users.sql first.';
  END IF;
END $$;

-- ── 1. Re-rank the sources ───────────────────────────────────────────
--   approved   an admin said yes — the last word
--   consensus  enough independent people suggested the same thing
--   michelin   the curated dataset
--   community  2+ people typed it on their own ratings
--   …
-- `user` is deliberately absent: it scores 0 and 068's guard drops the
-- write. That is the kill switch for any client still sending it.
CREATE OR REPLACE FUNCTION public.cuisine_source_confidence(src text)
RETURNS smallint
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT (CASE src
    WHEN 'approved'         THEN 100
    WHEN 'consensus'        THEN 95
    WHEN 'michelin'         THEN 90
    WHEN 'community'        THEN 80
    WHEN 'community_single' THEN 65
    WHEN 'google'           THEN 60
    WHEN 'google_display'   THEN 50
    WHEN 'name'             THEN 30
    ELSE 0
  END)::smallint;
$$;

-- Anything already written at the retired tier went in without review.
-- Drop those rows so the next resolve re-derives them honestly; a real
-- correction can be re-suggested through the flow below.
DELETE FROM public.restaurant_cuisine WHERE source = 'user';

-- ── 1b. Lock the reviewed tiers to the server ────────────────────────
-- Re-ranking alone is not enough. 068's RLS lets any signed-in user
-- upsert restaurant_cuisine, and its guard only mapped source → score —
-- so a client could simply POST source='approved' and skip this entire
-- file. Verified against a live database: it worked.
--
-- SECURITY INVOKER (the default) is load-bearing here, exactly as it is
-- for guard_profile_verification in 034: a PostgREST request runs as
-- `authenticated`, while apply_cuisine_suggestion() below is SECURITY
-- DEFINER and runs as the owner. So `current_user` is what separates a
-- write that went through review from one that claims it did.
CREATE OR REPLACE FUNCTION public.guard_restaurant_cuisine()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  privileged boolean := current_user NOT IN ('authenticated', 'anon');
BEGIN
  NEW.cuisine := btrim(coalesce(NEW.cuisine, ''));
  -- "Restaurant" is the non-answer this whole effort exists to remove;
  -- never let it be stored as if it were a cuisine.
  IF NEW.cuisine = '' OR lower(NEW.cuisine) = 'restaurant' THEN
    RETURN NULL;
  END IF;
  IF char_length(NEW.cuisine) > 60 THEN
    RETURN NULL;
  END IF;

  -- Tiers that mean "a human decided this" are server-only. A client
  -- asking for one is dropped, not downgraded: silently storing it a rung
  -- lower would be a write the caller never asked for.
  IF NOT privileged AND NEW.source IN ('approved', 'consensus', 'community') THEN
    RETURN NULL;
  END IF;

  NEW.confidence := public.cuisine_source_confidence(NEW.source);
  IF NEW.confidence = 0 THEN
    RETURN NULL;
  END IF;
  NEW.updated_at := now();

  IF TG_OP = 'UPDATE' THEN
    -- Strictly weaker source: keep what's there.
    IF NEW.confidence < OLD.confidence THEN
      RETURN NULL;
    END IF;
    -- Same strength, same answer: nothing to write.
    IF NEW.confidence = OLD.confidence AND NEW.cuisine = OLD.cuisine THEN
      RETURN NULL;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Drop anything a client managed to plant at a reviewed tier before this
-- landed. It never went through review, so it has no standing.
--
-- FIRST RUN ONLY. After this file exists, 'approved' and 'consensus' rows
-- are the output of the review flow below — the thing this migration is
-- for — and an unconditional DELETE would erase every approved correction
-- the moment anyone replayed the migration stack. cuisine_suggestions is
-- the marker: it is created further down, so its absence means this file
-- has never run here.
DO $$
BEGIN
  IF to_regclass('public.cuisine_suggestions') IS NULL THEN
    DELETE FROM public.restaurant_cuisine WHERE source IN ('approved', 'consensus');
  END IF;
END $$;

-- ── 2. Notification kinds ────────────────────────────────────────────
-- 065 constrained these to engagement. Widen them for review traffic.
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN ('like', 'comment', 'cuisine_suggested', 'cuisine_auto'));
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_subject_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_subject_type_check
  CHECK (subject_type IN ('post', 'reel', 'rating', 'cuisine'));

-- ── 3. The suggestions ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cuisine_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id text NOT NULL,
  -- Denormalized so the review queue reads in one query and still makes
  -- sense for a place the reviewer has never opened.
  restaurant_name text NOT NULL DEFAULT '',
  restaurant_address text NOT NULL DEFAULT '',
  -- What it currently shows, so a reviewer can see what is being changed.
  current_cuisine text NOT NULL DEFAULT '',
  cuisine text NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied', 'auto')),
  reviewed_by uuid,
  reviewed_at timestamptz,
  deny_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- One live suggestion per person per restaurant. Changing your mind
  -- replaces it; it never becomes a second vote.
  UNIQUE (restaurant_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_cuisine_suggestions_status
  ON public.cuisine_suggestions (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cuisine_suggestions_place
  ON public.cuisine_suggestions (restaurant_id, cuisine) WHERE status = 'pending';

ALTER TABLE public.cuisine_suggestions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read own suggestions or admin" ON public.cuisine_suggestions;
CREATE POLICY "Read own suggestions or admin"
  ON public.cuisine_suggestions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id OR public.is_app_admin());

-- Insert only your own, only as pending, never pre-reviewed.
DROP POLICY IF EXISTS "Insert own pending suggestion" ON public.cuisine_suggestions;
CREATE POLICY "Insert own pending suggestion"
  ON public.cuisine_suggestions FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND status = 'pending'
    AND reviewed_by IS NULL
    AND reviewed_at IS NULL
  );

-- Replacing your own still-pending suggestion is allowed; touching a
-- decided one, or anyone else's, is not.
DROP POLICY IF EXISTS "Replace own pending suggestion" ON public.cuisine_suggestions;
CREATE POLICY "Replace own pending suggestion"
  ON public.cuisine_suggestions FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id AND status = 'pending')
  WITH CHECK (auth.uid() = user_id AND status = 'pending');

-- Withdrawing your own pending suggestion.
DROP POLICY IF EXISTS "Delete own pending suggestion" ON public.cuisine_suggestions;
CREATE POLICY "Delete own pending suggestion"
  ON public.cuisine_suggestions FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id AND status = 'pending');

-- ── 4. Applying one ──────────────────────────────────────────────────
-- SECURITY DEFINER so it can write restaurant_cuisine at a tier no
-- client is allowed to send, and mark rows belonging to other people.
CREATE OR REPLACE FUNCTION public.apply_cuisine_suggestion(
  p_restaurant_id text,
  p_cuisine text,
  p_source text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.restaurant_cuisine (restaurant_id, cuisine, source)
  VALUES (p_restaurant_id, p_cuisine, p_source)
  ON CONFLICT (restaurant_id) DO UPDATE
    SET cuisine = EXCLUDED.cuisine, source = EXCLUDED.source;
END;
$$;
REVOKE ALL ON FUNCTION public.apply_cuisine_suggestion(text, text, text) FROM public, anon, authenticated;

-- ── 5. Auto-apply on agreement ───────────────────────────────────────
-- How many DIFFERENT people have to suggest the same cuisine for a
-- restaurant before it applies without review.
CREATE OR REPLACE FUNCTION public.cuisine_auto_apply_votes()
RETURNS integer LANGUAGE sql IMMUTABLE AS $$ SELECT 5 $$;

CREATE OR REPLACE FUNCTION public.on_cuisine_suggestion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_votes integer;
  v_needed integer := public.cuisine_auto_apply_votes();
  v_admin uuid;
BEGIN
  SELECT count(DISTINCT user_id) INTO v_votes
    FROM public.cuisine_suggestions
   WHERE restaurant_id = NEW.restaurant_id
     AND lower(btrim(cuisine)) = lower(btrim(NEW.cuisine))
     AND status = 'pending';

  IF v_votes >= v_needed THEN
    PERFORM public.apply_cuisine_suggestion(NEW.restaurant_id, btrim(NEW.cuisine), 'consensus');
    UPDATE public.cuisine_suggestions
       SET status = 'auto', reviewed_at = now()
     WHERE restaurant_id = NEW.restaurant_id
       AND lower(btrim(cuisine)) = lower(btrim(NEW.cuisine))
       AND status = 'pending';
  END IF;

  -- Tell the reviewers either way: a queue nobody is told about is a
  -- queue nobody reads, and an automatic change nobody is told about is
  -- exactly the silent edit this migration exists to stop.
  FOR v_admin IN SELECT user_id FROM public.app_admins LOOP
    INSERT INTO public.notifications
      (user_id, actor_id, kind, subject_type, subject_id, subject_label, preview, restaurant_id)
    VALUES (
      v_admin, NEW.user_id,
      CASE WHEN v_votes >= v_needed THEN 'cuisine_auto' ELSE 'cuisine_suggested' END,
      'cuisine', NEW.id,
      NEW.restaurant_name,
      CASE WHEN v_votes >= v_needed
        THEN btrim(NEW.cuisine) || ' — applied automatically (' || v_votes || ' agreed)'
        ELSE btrim(NEW.cuisine) END,
      NEW.restaurant_id
    );
  END LOOP;

  RETURN NULL; -- AFTER trigger: return value is ignored
END;
$$;

DROP TRIGGER IF EXISTS trg_on_cuisine_suggestion ON public.cuisine_suggestions;
CREATE TRIGGER trg_on_cuisine_suggestion
  AFTER INSERT OR UPDATE OF cuisine ON public.cuisine_suggestions
  FOR EACH ROW
  WHEN (NEW.status = 'pending')
  EXECUTE FUNCTION public.on_cuisine_suggestion();

-- ── 6. Review ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.approve_cuisine_suggestion(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  req public.cuisine_suggestions%ROWTYPE;
BEGIN
  IF NOT public.is_app_admin() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  SELECT * INTO req FROM public.cuisine_suggestions
    WHERE id = p_id AND status = 'pending' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'suggestion not found or already decided';
  END IF;

  PERFORM public.apply_cuisine_suggestion(req.restaurant_id, btrim(req.cuisine), 'approved');

  -- Everyone who suggested this same cuisine for this place was right,
  -- so their suggestion is approved too rather than left pending forever.
  UPDATE public.cuisine_suggestions
     SET status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(), deny_reason = NULL
   WHERE restaurant_id = req.restaurant_id
     AND lower(btrim(cuisine)) = lower(btrim(req.cuisine))
     AND status = 'pending';
END;
$$;

CREATE OR REPLACE FUNCTION public.deny_cuisine_suggestion(p_id uuid, p_reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_app_admin() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  UPDATE public.cuisine_suggestions
     SET status = 'denied', reviewed_by = auth.uid(), reviewed_at = now(),
         deny_reason = nullif(btrim(p_reason), '')
   WHERE id = p_id AND status = 'pending';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'suggestion not found or already decided';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.approve_cuisine_suggestion(uuid) FROM public, anon;
REVOKE ALL ON FUNCTION public.deny_cuisine_suggestion(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.approve_cuisine_suggestion(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.deny_cuisine_suggestion(uuid, text) TO authenticated;

-- ── Verify ───────────────────────────────────────────────────────────
--   SELECT status, count(*) FROM public.cuisine_suggestions GROUP BY status;
--   SELECT source, count(*) FROM public.restaurant_cuisine GROUP BY source;
