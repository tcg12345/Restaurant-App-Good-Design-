-- 064: link a post to the rating it shares.
--
-- Posts and ratings were two disconnected records. Someone who rated a
-- restaurant AND posted photos of the same dinner produced two rows that
-- the app had no way to recognise as one meal, so the feed showed both —
-- the "duplicate entries" beta testers reported.
--
-- `rating_id` makes the relationship explicit: a post published from the
-- rating flow points at its community_ratings row, and the feed drops the
-- standalone rating for any post that links one (see lib/feedEntry.ts
-- mergeFeed). ON DELETE SET NULL so deleting a rating leaves the shared
-- photos intact as a plain post rather than cascading them away.
--
-- `score` is the score AT SHARE TIME. It lives on the post so a past
-- visit's card stays a faithful record after the restaurant is re-rated —
-- community_ratings is UNIQUE(user_id, restaurant_id) and upserts, so the
-- rating row alone can't tell you what you thought last April.
--
-- Run this in your Supabase SQL Editor. Safe to run multiple times.

ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS rating_id UUID REFERENCES public.community_ratings(id) ON DELETE SET NULL;

ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS score NUMERIC CHECK (score IS NULL OR (score >= 0 AND score <= 10));

-- The feed dedupe looks posts up by the rating they share.
CREATE INDEX IF NOT EXISTS posts_rating_id_idx ON public.posts (rating_id) WHERE rating_id IS NOT NULL;

COMMENT ON COLUMN public.posts.rating_id IS
  'The community_ratings row this post shares, when published from the rating flow. NULL for a plain photo post. The feed shows a linked rating once (as this post), never twice.';
COMMENT ON COLUMN public.posts.score IS
  'Score at share time (0-10), copied from the linked rating. NULL for a plain photo post.';
