-- 068: Shared restaurant cuisine cache — and a backfill that fills it from
-- the cuisines your users have already typed.
-- ════════════════════════════════════════════════════════════════════
-- Cuisine is resolved from a Google place payload (lib/cuisine.ts), which
-- only whoever opened the restaurant's detail page actually holds. Everyone
-- else — every saved rating, list row, profile top list — has just a place
-- id, a name and an address, so a place whose cuisine Google doesn't state
-- in `types` stayed blank for everybody, forever, no matter how many people
-- had eaten there and said what it was.
--
-- This table is that missing shared memory. It is derived, non-sensitive
-- data keyed by the public place id, so — exactly like restaurant_geo
-- (migration 054) — any authenticated user may read and write it: whoever
-- resolves a place first pays for it once and everyone else gets a batched
-- read.
--
-- Unlike restaurant_geo, last-writer-wins is NOT good enough here. Two
-- writers can disagree (a user correction vs. a guess from the name), so
-- every row carries the source that produced it and writes are ranked: a
-- weaker source can never overwrite a stronger one. Clients send only the
-- source; the confidence is assigned here, so a client cannot promote its
-- own guess.

CREATE TABLE IF NOT EXISTS public.restaurant_cuisine (
  restaurant_id text PRIMARY KEY,
  cuisine text NOT NULL,
  -- 'user' | 'michelin' | 'community' | 'community_single' | 'google'
  -- | 'google_display' | 'name'. See cuisine_source_confidence().
  source text NOT NULL,
  -- Derived from `source` by the guard trigger — never trusted from a client.
  confidence smallint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ── Source ranking ───────────────────────────────────────────────────
-- The ordering is "how directly does this come from a human who knows".
--   user             a person corrected it in-app — always wins
--   michelin         the curated Michelin dataset shipped with the app
--   community        2+ of your users independently typed the same thing
--   community_single exactly one person typed it — real, but unconfirmed
--   google           Google's own primaryType / types for the place
--   google_display   Google's display label, outside our taxonomy
--   name             inferred from the restaurant's name ("Taqueria …")
-- An unknown source scores 0 and the trigger drops the write entirely,
-- so a future client sending a source this migration hasn't heard of
-- cannot land an unranked row.
CREATE OR REPLACE FUNCTION public.cuisine_source_confidence(src text)
RETURNS smallint
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT (CASE src
    WHEN 'user'             THEN 100
    WHEN 'michelin'         THEN 90
    WHEN 'community'        THEN 80
    WHEN 'community_single' THEN 65
    WHEN 'google'           THEN 60
    WHEN 'google_display'   THEN 50
    WHEN 'name'             THEN 30
    ELSE 0
  END)::smallint;
$$;

-- ── Write guard ──────────────────────────────────────────────────────
-- Returning NULL from a BEFORE ROW trigger drops that row's operation
-- silently, which is what we want for every rejected write: clients
-- upsert best-effort and must not see an error for "someone already knew
-- better".
CREATE OR REPLACE FUNCTION public.guard_restaurant_cuisine()
RETURNS trigger
LANGUAGE plpgsql
AS $$
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

DROP TRIGGER IF EXISTS trg_guard_restaurant_cuisine ON public.restaurant_cuisine;
CREATE TRIGGER trg_guard_restaurant_cuisine
  BEFORE INSERT OR UPDATE ON public.restaurant_cuisine
  FOR EACH ROW EXECUTE FUNCTION public.guard_restaurant_cuisine();

-- ── RLS ──────────────────────────────────────────────────────────────
-- Same posture as restaurant_geo: readable and writable by any signed-in
-- user, because the content is derived facts about public places. The
-- trigger, not RLS, is what stops a weak write from destroying a strong
-- one. (A client can still claim source='user'; that is the same trust
-- level the geo cache already operates at, and the blast radius is one
-- wrong cuisine label that any other user can correct.)
ALTER TABLE public.restaurant_cuisine ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can read cuisine cache" ON public.restaurant_cuisine;
CREATE POLICY "Authenticated can read cuisine cache"
  ON public.restaurant_cuisine FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Authenticated can insert cuisine cache" ON public.restaurant_cuisine;
CREATE POLICY "Authenticated can insert cuisine cache"
  ON public.restaurant_cuisine FOR INSERT
  TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated can update cuisine cache" ON public.restaurant_cuisine;
CREATE POLICY "Authenticated can update cuisine cache"
  ON public.restaurant_cuisine FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- ── Backfill from ratings people have already written ────────────────
-- The single biggest source of accurate cuisine data the app already owns:
-- every community rating carries the cuisine that was on the card when it
-- was saved, and plenty of those were resolved on a device that DID have
-- the Google payload. Fold them into one answer per restaurant — the label
-- the most distinct people agree on — and the cache starts populated
-- instead of empty.
--
-- Re-runnable: ON CONFLICT DO NOTHING leaves any row already in the table
-- (including later user corrections) untouched.
INSERT INTO public.restaurant_cuisine (restaurant_id, cuisine, source)
SELECT restaurant_id, cuisine,
       CASE WHEN voters >= 2 THEN 'community' ELSE 'community_single' END
FROM (
  SELECT restaurant_id, cuisine, voters,
         row_number() OVER (
           PARTITION BY restaurant_id
           -- Most people first; ties broken alphabetically so the result
           -- is deterministic rather than whatever the planner returns.
           ORDER BY voters DESC, cuisine ASC
         ) AS rn
  FROM (
    SELECT restaurant_id,
           btrim(cuisine) AS cuisine,
           count(DISTINCT user_id) AS voters
    FROM public.community_ratings
    WHERE restaurant_id IS NOT NULL
      AND btrim(coalesce(cuisine, '')) <> ''
      AND lower(btrim(coalesce(cuisine, ''))) <> 'restaurant'
      AND char_length(btrim(cuisine)) <= 60
    GROUP BY restaurant_id, btrim(cuisine)
  ) labelled
) ranked
WHERE rn = 1
ON CONFLICT (restaurant_id) DO NOTHING;

-- ── Verify ───────────────────────────────────────────────────────────
--   SELECT source, count(*) FROM public.restaurant_cuisine
--    GROUP BY source ORDER BY 2 DESC;
-- and, to see what the backfill still leaves open:
--   SELECT count(DISTINCT r.restaurant_id)
--     FROM public.community_ratings r
--     LEFT JOIN public.restaurant_cuisine c USING (restaurant_id)
--    WHERE c.restaurant_id IS NULL;
