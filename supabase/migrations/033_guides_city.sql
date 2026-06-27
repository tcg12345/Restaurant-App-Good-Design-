-- 033: optional `city` tag on guides.
-- ════════════════════════════════════════════════════════════════════
-- Lets a guide author say which city a guide is "for" so it surfaces on that
-- city's Location page (Guides rail). A guide ALSO surfaces there when any of
-- its restaurant entries is in that city (matched in-app from the city stored
-- on each entry inside the `entries` JSONB), so this column is a convenience,
-- not a requirement.
--
-- Nullable + no backfill: existing guides simply have no explicit city tag and
-- continue to be discoverable via their entries. saveGuide() degrades
-- gracefully if this migration hasn't run yet (it retries the upsert without
-- the column), so applying it is safe at any time.

alter table public.guides add column if not exists city text;
