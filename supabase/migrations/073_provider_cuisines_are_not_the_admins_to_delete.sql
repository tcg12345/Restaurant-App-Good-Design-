-- 073: A cuisine that came from a provider is not the admin's to delete.
-- ════════════════════════════════════════════════════════════════════
-- 071 gave the review queue a remove control so a restaurant at the cap
-- could accept another suggestion. It removes anything, and for a
-- provider-derived cuisine that is wrong twice over:
--
--   1. It is not ours to delete. Google's read of a place, the Michelin
--      Guide's, a mapper's cuisine=* tag — those are what the source says.
--      An admin disagreeing with one is a reason to rank something above
--      it, not to erase what it said.
--
--   2. It does not even work. settleRestaurantCuisine re-publishes what it
--      derives locally whenever it beats what is cached, so deleting a
--      google row with nothing to promote in its place empties the row and
--      the next person to open that restaurant's detail page puts it
--      straight back at tier 60. The control was a button that lied.
--
-- Promotion is untouched and is the answer to a WRONG provider cuisine:
-- approving a suggestion as the primary writes it at 'approved' (100),
-- which outranks google (60) permanently — the guard in 068 drops every
-- later re-publish. So a correction still sticks; it just goes through
-- review, which is the whole point of this subsystem.
--
-- Run AFTER 071.

DO $$
BEGIN
  IF to_regclass('public.restaurant_cuisine_tags') IS NULL THEN
    RAISE EXCEPTION 'public.restaurant_cuisine_tags is missing — run 071_multiple_cuisines.sql first.';
  END IF;
END $$;

-- ── 1. Which cuisines a person may take away ─────────────────────────
-- The ones a person put there. Everything else is a provider's answer or
-- a guess the app will simply make again.
--
--   approved / consensus         a human decided this
--   community / community_single your users typed it on their own ratings
--   ---------------------------------------------------------------
--   michelin / google / google_display / osm   what a source says
--   name                         a guess from the restaurant's name, and
--                                re-derived on sight
CREATE OR REPLACE FUNCTION public.cuisine_source_is_removable(src text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT coalesce(src, '') IN ('approved', 'consensus', 'community', 'community_single');
$$;

-- ── 2. Removal refuses one ───────────────────────────────────────────
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
  v_cuisine text := btrim(coalesce(p_cuisine, ''));
  v_primary text;
  v_source text;
  v_next public.restaurant_cuisine_tags%ROWTYPE;
BEGIN
  IF NOT public.is_app_admin() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  SELECT cuisine, source INTO v_primary, v_source
    FROM public.restaurant_cuisine
   WHERE restaurant_id = p_restaurant_id;

  IF v_primary IS NOT NULL AND lower(v_primary) = lower(v_cuisine) THEN
    -- The primary. Provider-derived ones stay.
    IF NOT public.cuisine_source_is_removable(v_source) THEN
      RAISE EXCEPTION '% came from %, so it cannot be removed — approve a suggestion as the primary to rank another cuisine above it instead',
        v_primary, v_source;
    END IF;

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
    RETURN;
  END IF;

  -- An additional cuisine. 071 only ever writes these at 'approved' or
  -- 'consensus', so they are removable by construction — but check rather
  -- than assume, so a future writer can't quietly become undeletable.
  SELECT source INTO v_source FROM public.restaurant_cuisine_tags
   WHERE restaurant_id = p_restaurant_id AND lower(cuisine) = lower(v_cuisine);
  IF NOT FOUND THEN
    RETURN;   -- already gone; nothing to do and nothing to complain about
  END IF;
  IF NOT public.cuisine_source_is_removable(v_source) THEN
    RAISE EXCEPTION '% came from %, so it cannot be removed', v_cuisine, v_source;
  END IF;

  DELETE FROM public.restaurant_cuisine_tags
   WHERE restaurant_id = p_restaurant_id AND lower(cuisine) = lower(v_cuisine);
END;
$$;

REVOKE ALL ON FUNCTION public.remove_restaurant_cuisine(text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.remove_restaurant_cuisine(text, text) TO authenticated;

-- ── Verify ───────────────────────────────────────────────────────────
--   SELECT c.restaurant_id, c.cuisine, c.source,
--          public.cuisine_source_is_removable(c.source) AS removable
--     FROM public.restaurant_cuisine c ORDER BY 3;
