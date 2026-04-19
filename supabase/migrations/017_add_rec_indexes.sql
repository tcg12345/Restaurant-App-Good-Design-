-- Indexes backing the advanced recommendation engine in src/lib/recommendations.ts.
-- The tag-similarity query uses array overlap on community_ratings.tags,
-- which needs a GIN index to be fast. The location-bounded filter uses
-- (lat, lng), which benefits from a btree composite when candidates are
-- narrowed to a city.

CREATE INDEX IF NOT EXISTS idx_community_ratings_tags_gin
  ON public.community_ratings USING GIN (tags);

CREATE INDEX IF NOT EXISTS idx_community_ratings_coords
  ON public.community_ratings (lat, lng);
