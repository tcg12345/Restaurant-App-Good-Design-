-- 071: A restaurant can be more than one thing.
-- ════════════════════════════════════════════════════════════════════
-- Plenty of restaurants are honestly two or three cuisines — Tex-Mex that
-- is also BBQ, a Greek place that is also a seafood place, an izakaya that
-- is also a sushi bar. One label per restaurant forces a choice that is
-- wrong either way.
--
-- The rule that matters is WHERE the extra ones come from. The automatic
-- sources (Google, Michelin, OSM, a guess from the name) each produce one
-- answer and have no opinion about a second, so letting them stack would
-- just accumulate noise. Additional cuisines come only from people: an
-- admin approving a suggestion, or enough independent users suggesting the
-- same thing — the flow migration 069 already built.
--
-- Shape:
--
--   restaurant_cuisine       the PRIMARY cuisine. Unchanged from 068/070:
--                            same ranking, same guard, same one row per
--                            restaurant. Everything that filters, groups or
--                            counts by cuisine keeps reading exactly this.
--   restaurant_cuisine_tags  the additional ones. Server-written only, and
--                            only ever by the review flow below.
--
-- Keeping the primary where it was is deliberate. Profile top lists, search
-- facets and saved ratings all want ONE canonical cuisine, and a schema that
-- made them ask "which of the three?" would push that question into a dozen
-- call sites.
--
-- Run AFTER 069 (suggestions) and 070 (the osm tier).

-- ── 0. Preconditions ─────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.restaurant_cuisine') IS NULL THEN
    RAISE EXCEPTION 'public.restaurant_cuisine is missing — run 068_restaurant_cuisine.sql first.';
  END IF;
  IF to_regclass('public.cuisine_suggestions') IS NULL THEN
    RAISE EXCEPTION 'public.cuisine_suggestions is missing — run 069_cuisine_suggestions.sql first.';
  END IF;
END $$;

-- ── 1. How many ─────────────────────────────────────────────────────
-- Three, counting the primary. Past three a cuisine list stops describing
-- a restaurant and starts describing the idea of restaurants.
CREATE OR REPLACE FUNCTION public.cuisine_max_count()
RETURNS integer LANGUAGE sql IMMUTABLE AS $$ SELECT 3 $$;

-- ── 2. The additional cuisines ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.restaurant_cuisine_tags (
  restaurant_id text NOT NULL,
  cuisine text NOT NULL,
  -- 'approved' (an admin said yes) | 'consensus' (enough people agreed).
  -- No automatic source may ever appear here; see the guard below.
  source text NOT NULL,
  -- How many people had suggested it when it landed. Kept for the review
  -- UI and so the ordering below can prefer the better-agreed tag.
  votes smallint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (restaurant_id, cuisine)
);

CREATE INDEX IF NOT EXISTS idx_restaurant_cuisine_tags_place
  ON public.restaurant_cuisine_tags (restaurant_id, created_at);

-- ── 2b. Nothing writes here except the review flow ───────────────────
-- Same posture, and the same reasoning, as the reviewed tiers in 069: a
-- PostgREST request runs as `authenticated`, the functions below are
-- SECURITY DEFINER and run as the owner, so `current_user` is what
-- separates a tag that went through review from one that claims it did.
CREATE OR REPLACE FUNCTION public.guard_restaurant_cuisine_tags()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  privileged boolean := current_user NOT IN ('authenticated', 'anon');
  v_count integer;
BEGIN
  IF NOT privileged THEN
    RETURN NULL;
  END IF;

  NEW.cuisine := btrim(coalesce(NEW.cuisine, ''));
  IF NEW.cuisine = '' OR lower(NEW.cuisine) = 'restaurant' THEN
    RETURN NULL;
  END IF;
  IF char_length(NEW.cuisine) > 60 THEN
    RETURN NULL;
  END IF;
  IF NEW.source NOT IN ('approved', 'consensus') THEN
    RETURN NULL;
  END IF;

  -- Never duplicate the primary as a tag.
  IF EXISTS (
    SELECT 1 FROM public.restaurant_cuisine
     WHERE restaurant_id = NEW.restaurant_id
       AND lower(cuisine) = lower(NEW.cuisine)
  ) THEN
    RETURN NULL;
  END IF;

  -- The cap, enforced here rather than only in the caller, so no future
  -- path can add a fourth by forgetting to check.
  IF TG_OP = 'INSERT' THEN
    SELECT count(*) INTO v_count FROM public.restaurant_cuisine_tags
     WHERE restaurant_id = NEW.restaurant_id;
    -- +1 for the primary, which always occupies the first slot.
    IF v_count + 1 >= public.cuisine_max_count() THEN
      RETURN NULL;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_restaurant_cuisine_tags ON public.restaurant_cuisine_tags;
CREATE TRIGGER trg_guard_restaurant_cuisine_tags
  BEFORE INSERT OR UPDATE ON public.restaurant_cuisine_tags
  FOR EACH ROW EXECUTE FUNCTION public.guard_restaurant_cuisine_tags();

-- Readable by anyone signed in — it is derived, public data about public
-- places, exactly like the primary. Writable by nobody: no INSERT, UPDATE
-- or DELETE policy exists, so only the SECURITY DEFINER functions below
-- (and the service role) can change it. That is the intent, not an
-- oversight.
ALTER TABLE public.restaurant_cuisine_tags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can read cuisine tags" ON public.restaurant_cuisine_tags;
CREATE POLICY "Authenticated can read cuisine tags"
  ON public.restaurant_cuisine_tags FOR SELECT
  TO authenticated
  USING (true);

-- ── 3. Applying a suggestion ─────────────────────────────────────────
-- Replaces 069's version. Two modes, because a suggestion can mean two
-- genuinely different things and only a reviewer knows which:
--
--   'add'      this is ALSO true of the place. The common case, and what
--              consensus uses — when strangers agree on a cuisine the
--              place doesn't have yet, adding is the safe reading.
--   'primary'  what is there now is WRONG. Replaces it outright rather
--              than demoting it, because a correction is a statement that
--              the old label should not be shown at all. This is what
--              makes "the cuisine I fixed actually stays fixed" work.
--
-- Returns true when the restaurant's cuisines now include p_cuisine —
-- including when they already did. False means there was no room, which
-- is a decision for a human rather than an error.
DROP FUNCTION IF EXISTS public.apply_cuisine_suggestion(text, text, text);
CREATE OR REPLACE FUNCTION public.apply_cuisine_suggestion(
  p_restaurant_id text,
  p_cuisine text,
  p_source text,
  p_mode text DEFAULT 'add',
  p_votes integer DEFAULT 1
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_cuisine text := btrim(coalesce(p_cuisine, ''));
  v_primary text;
  v_tags integer;
BEGIN
  IF v_cuisine = '' THEN
    RETURN false;
  END IF;

  SELECT cuisine INTO v_primary FROM public.restaurant_cuisine
   WHERE restaurant_id = p_restaurant_id;

  IF p_mode = 'primary' THEN
    INSERT INTO public.restaurant_cuisine (restaurant_id, cuisine, source)
    VALUES (p_restaurant_id, v_cuisine, p_source)
    ON CONFLICT (restaurant_id) DO UPDATE
      SET cuisine = EXCLUDED.cuisine, source = EXCLUDED.source;
    -- If it was also sitting in the tags, it is the primary now.
    DELETE FROM public.restaurant_cuisine_tags
     WHERE restaurant_id = p_restaurant_id AND lower(cuisine) = lower(v_cuisine);
    RETURN true;
  END IF;

  -- 'add' — and with no primary yet, the first cuisine simply becomes it.
  IF v_primary IS NULL OR btrim(v_primary) = '' THEN
    INSERT INTO public.restaurant_cuisine (restaurant_id, cuisine, source)
    VALUES (p_restaurant_id, v_cuisine, p_source)
    ON CONFLICT (restaurant_id) DO UPDATE
      SET cuisine = EXCLUDED.cuisine, source = EXCLUDED.source;
    RETURN true;
  END IF;

  -- Already known, in either slot: nothing to do, and not a failure.
  IF lower(v_primary) = lower(v_cuisine) THEN
    RETURN true;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.restaurant_cuisine_tags
     WHERE restaurant_id = p_restaurant_id AND lower(cuisine) = lower(v_cuisine)
  ) THEN
    RETURN true;
  END IF;

  SELECT count(*) INTO v_tags FROM public.restaurant_cuisine_tags
   WHERE restaurant_id = p_restaurant_id;
  IF v_tags + 1 >= public.cuisine_max_count() THEN
    RETURN false;   -- full; a human decides what to drop
  END IF;

  INSERT INTO public.restaurant_cuisine_tags (restaurant_id, cuisine, source, votes)
  VALUES (p_restaurant_id, v_cuisine, p_source, greatest(1, coalesce(p_votes, 1)))
  ON CONFLICT (restaurant_id, cuisine) DO NOTHING;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.apply_cuisine_suggestion(text, text, text, text, integer) FROM public, anon, authenticated;

-- ── 4. Consensus ─────────────────────────────────────────────────────
-- Unchanged in spirit: enough independent people suggesting the same thing
-- applies it without review. It now ADDS rather than replaces — strangers
-- agreeing that a place is also Korean is not evidence that it isn't also
-- what it already says.
--
-- When there is no room, the suggestions stay pending and the reviewers
-- are told the ordinary way. Silently dropping the crowd's answer, or
-- silently evicting a cuisine to make space, are both worse than asking.
CREATE OR REPLACE FUNCTION public.on_cuisine_suggestion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_votes integer;
  v_needed integer := public.cuisine_auto_apply_votes();
  v_applied boolean := false;
  v_admin uuid;
BEGIN
  SELECT count(DISTINCT user_id) INTO v_votes
    FROM public.cuisine_suggestions
   WHERE restaurant_id = NEW.restaurant_id
     AND lower(btrim(cuisine)) = lower(btrim(NEW.cuisine))
     AND status = 'pending';

  IF v_votes >= v_needed THEN
    v_applied := public.apply_cuisine_suggestion(
      NEW.restaurant_id, btrim(NEW.cuisine), 'consensus', 'add', v_votes);
    IF v_applied THEN
      UPDATE public.cuisine_suggestions
         SET status = 'auto', reviewed_at = now()
       WHERE restaurant_id = NEW.restaurant_id
         AND lower(btrim(cuisine)) = lower(btrim(NEW.cuisine))
         AND status = 'pending';
    END IF;
  END IF;

  FOR v_admin IN SELECT user_id FROM public.app_admins LOOP
    INSERT INTO public.notifications
      (user_id, actor_id, kind, subject_type, subject_id, subject_label, preview, restaurant_id)
    VALUES (
      v_admin, NEW.user_id,
      CASE WHEN v_applied THEN 'cuisine_auto' ELSE 'cuisine_suggested' END,
      'cuisine', NEW.id,
      NEW.restaurant_name,
      CASE
        WHEN v_applied THEN btrim(NEW.cuisine) || ' — added automatically (' || v_votes || ' agreed)'
        WHEN v_votes >= v_needed THEN btrim(NEW.cuisine) || ' — ' || v_votes
          || ' agreed, but this restaurant already has ' || public.cuisine_max_count() || ' cuisines'
        ELSE btrim(NEW.cuisine)
      END,
      NEW.restaurant_id
    );
  END LOOP;

  RETURN NULL; -- AFTER trigger: return value is ignored
END;
$$;

-- ── 5. Review ────────────────────────────────────────────────────────
-- The mode is the reviewer's, so it is a parameter rather than a guess.
-- It defaults to 'add' so an older client that only sends p_id keeps
-- working, and gets the conservative behaviour.
DROP FUNCTION IF EXISTS public.approve_cuisine_suggestion(uuid);
CREATE OR REPLACE FUNCTION public.approve_cuisine_suggestion(
  p_id uuid,
  p_mode text DEFAULT 'add'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  req public.cuisine_suggestions%ROWTYPE;
  v_votes integer;
  v_applied boolean;
BEGIN
  IF NOT public.is_app_admin() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  IF p_mode NOT IN ('add', 'primary') THEN
    RAISE EXCEPTION 'unknown mode %', p_mode;
  END IF;
  SELECT * INTO req FROM public.cuisine_suggestions
    WHERE id = p_id AND status = 'pending' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'suggestion not found or already decided';
  END IF;

  SELECT count(DISTINCT user_id) INTO v_votes
    FROM public.cuisine_suggestions
   WHERE restaurant_id = req.restaurant_id
     AND lower(btrim(cuisine)) = lower(btrim(req.cuisine))
     AND status = 'pending';

  v_applied := public.apply_cuisine_suggestion(
    req.restaurant_id, btrim(req.cuisine), 'approved', p_mode, v_votes);

  -- Unlike consensus, a full restaurant IS an error here: the reviewer
  -- pressed a button and is owed an answer rather than a silent no-op.
  IF NOT v_applied THEN
    RAISE EXCEPTION 'this restaurant already has % cuisines — remove one, or approve as the primary',
      public.cuisine_max_count();
  END IF;

  -- Everyone who suggested this same cuisine for this place was right,
  -- so their suggestion is approved too rather than left pending forever.
  UPDATE public.cuisine_suggestions
     SET status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(), deny_reason = NULL
   WHERE restaurant_id = req.restaurant_id
     AND lower(btrim(cuisine)) = lower(btrim(req.cuisine))
     AND status = 'pending';
END;
$$;

-- ── 6. Taking one away ───────────────────────────────────────────────
-- Without this, a restaurant at the cap is frozen: no suggestion can ever
-- be approved for it again. Removing the primary promotes the
-- best-agreed tag in its place rather than leaving the restaurant blank.
CREATE OR REPLACE FUNCTION public.remove_restaurant_cuisine(
  p_restaurant_id text,
  p_cuisine text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_primary text;
  v_next public.restaurant_cuisine_tags%ROWTYPE;
BEGIN
  IF NOT public.is_app_admin() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  SELECT cuisine INTO v_primary FROM public.restaurant_cuisine
   WHERE restaurant_id = p_restaurant_id;

  IF v_primary IS NOT NULL AND lower(v_primary) = lower(btrim(p_cuisine)) THEN
    SELECT * INTO v_next FROM public.restaurant_cuisine_tags
     WHERE restaurant_id = p_restaurant_id
     ORDER BY votes DESC, created_at ASC
     LIMIT 1;
    IF FOUND THEN
      UPDATE public.restaurant_cuisine
         SET cuisine = v_next.cuisine, source = v_next.source, updated_at = now()
       WHERE restaurant_id = p_restaurant_id;
      DELETE FROM public.restaurant_cuisine_tags
       WHERE restaurant_id = p_restaurant_id AND cuisine = v_next.cuisine;
    ELSE
      DELETE FROM public.restaurant_cuisine WHERE restaurant_id = p_restaurant_id;
    END IF;
  ELSE
    DELETE FROM public.restaurant_cuisine_tags
     WHERE restaurant_id = p_restaurant_id AND lower(cuisine) = lower(btrim(p_cuisine));
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.approve_cuisine_suggestion(uuid, text) FROM public, anon;
REVOKE ALL ON FUNCTION public.remove_restaurant_cuisine(text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.approve_cuisine_suggestion(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_restaurant_cuisine(text, text) TO authenticated;

-- ── Verify ───────────────────────────────────────────────────────────
--   SELECT c.restaurant_id, c.cuisine AS primary_cuisine,
--          array_agg(t.cuisine ORDER BY t.votes DESC, t.created_at) AS also
--     FROM public.restaurant_cuisine c
--     LEFT JOIN public.restaurant_cuisine_tags t USING (restaurant_id)
--    GROUP BY 1, 2 HAVING count(t.cuisine) > 0;
