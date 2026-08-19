-- 070: OpenStreetMap as the backup source for cuisine, plus the bookkeeping
-- that stops us asking it the same question twice.
-- ════════════════════════════════════════════════════════════════════
-- Where the gap actually is: Google describes big-city restaurants well
-- and rural ones badly. Measured on this app's own ratings, every place
-- with no usable cuisine was outside a metro area — inns, farmhouse
-- restaurants, hotel dining rooms — and Google returned nothing better
-- than "Restaurant" for them.
--
-- OpenStreetMap is strongest in exactly that gap. Its `cuisine=*` tag is
-- entered by a person who went to the place, and rural coverage is the
-- part of OSM volunteers care most about. It is free, it has no quota to
-- burn, and it is licensed ODbL — attribution is surfaced in the app.
--
-- Two pieces here:
--   1. `osm` joins the source ranking at 55, and — like the reviewed
--      tiers — becomes server-only, because no client can legitimately
--      produce one. The lookup runs in the cuisine-lookup Edge Function
--      with the service role.
--   2. restaurant_cuisine_lookups remembers that we asked, so a place OSM
--      doesn't know about costs one Overpass query ever, not one per
--      person who opens it. This negative cache is the difference between
--      a feature that scales and a fair-use ban.
--
-- Run AFTER 068 (restaurant_cuisine) and 069 (the review flow).

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

-- ── 1. Where OSM sits in the ranking ─────────────────────────────────
--   approved   100  an admin said yes
--   consensus   95  enough independent people agreed
--   michelin    90  the curated dataset
--   community   80  2+ people typed it on their own ratings
--   community_single 65
--   google      60  Google's own primaryType / types
--   osm         55  a mapper's cuisine=* tag, name- and distance-matched
--   google_display 50  Google's label, outside our taxonomy
--   name        30  inferred from the restaurant's name
--
-- Above google_display and below google, deliberately. An OSM tag says
-- what the kitchen cooks, which beats Google's "Fine dining restaurant";
-- but it reaches us through a name match against a nearby element, and
-- that match can be wrong in a way Google's own typing of a place id
-- cannot. In practice the ordering rarely decides anything — this runs
-- precisely where Google said nothing at all.
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
    WHEN 'osm'              THEN 55
    WHEN 'google_display'   THEN 50
    WHEN 'name'             THEN 30
    ELSE 0
  END)::smallint;
$$;

-- ── 2. Lock `osm` to the server ──────────────────────────────────────
-- Same reasoning as the reviewed tiers in 069. The Overpass call happens
-- in an Edge Function; a browser has no way to arrive at an `osm` answer
-- honestly, so a browser claiming one is claiming something it cannot
-- have. Dropped rather than downgraded — silently storing it a rung
-- lower would be a write the caller never asked for.
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

  -- Tiers that mean "a human decided this" — or "a server went and
  -- looked" — are not things a client gets to assert.
  IF NOT privileged AND NEW.source IN ('approved', 'consensus', 'community', 'osm') THEN
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

-- No cleanup pass for pre-existing `osm` rows, deliberately: before this
-- file, `osm` scored 0 and 068's guard dropped the write, so none can
-- exist. A DELETE here would do nothing on the first run and destroy every
-- real lookup on a second one.

-- ── 3. "We already asked" ────────────────────────────────────────────
-- A miss is a result. Without recording it, every person who opens a
-- rural restaurant OSM has never heard of triggers another Overpass
-- query for the same nothing — which is both pointless and the fastest
-- way to get a fair-use block from a volunteer-funded API.
--
-- `found` is kept (rather than only storing misses) so the hit rate is
-- measurable: it is the number this phase should be judged on.
CREATE TABLE IF NOT EXISTS public.restaurant_cuisine_lookups (
  restaurant_id text NOT NULL,
  provider text NOT NULL,
  found boolean NOT NULL DEFAULT false,
  -- The coordinates the lookup actually used, so a miss can be told
  -- apart from a lookup that searched the wrong patch of the planet.
  lat double precision,
  lng double precision,
  checked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (restaurant_id, provider)
);

-- Re-checking misses: OSM gains detail constantly, so a miss is only
-- good for a while. The function uses this index to age rows out.
CREATE INDEX IF NOT EXISTS idx_cuisine_lookups_stale
  ON public.restaurant_cuisine_lookups (provider, checked_at)
  WHERE NOT found;

-- RLS on with NO policies at all: this is server bookkeeping. The Edge
-- Function reaches it with the service role, which bypasses RLS; every
-- browser request runs as `authenticated`, matches no policy, and sees
-- an empty table it cannot write. That is the intent, not an oversight.
ALTER TABLE public.restaurant_cuisine_lookups ENABLE ROW LEVEL SECURITY;

-- ── 4. How long a miss stands ────────────────────────────────────────
-- 45 days. Long enough that a place OSM doesn't cover isn't re-queried
-- every week; short enough that a mapper adding a cuisine tag shows up
-- in the app within a season.
CREATE OR REPLACE FUNCTION public.cuisine_lookup_ttl_days()
RETURNS integer LANGUAGE sql IMMUTABLE AS $$ SELECT 45 $$;

-- ── Verify ───────────────────────────────────────────────────────────
--   SELECT source, count(*) FROM public.restaurant_cuisine
--    GROUP BY source ORDER BY 2 DESC;
--   SELECT provider, found, count(*) FROM public.restaurant_cuisine_lookups
--    GROUP BY provider, found;
