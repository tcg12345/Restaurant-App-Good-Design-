-- 020: Per-reel visibility — public vs. followers-only.
-- ════════════════════════════════════════════════════════════════════
-- Adds an is_public flag to public.reels and tightens the SELECT policy
-- so private reels are only visible to:
--   • the author themselves
--   • users the author has accepted as followers (rows in user_friends
--     where user_id = viewer AND friend_id = author AND status = 'accepted')
-- Existing rows backfill to TRUE so nothing disappears from public feeds.

ALTER TABLE public.reels
  ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT true;

-- Useful index for "show me only public reels" filters; the policy can also
-- short-circuit on this column when the viewer is anonymous.
CREATE INDEX IF NOT EXISTS idx_reels_is_public ON public.reels(is_public, created_at DESC);

-- Replace the old "Anyone can read reels" policy with one that enforces
-- the visibility scope.
DROP POLICY IF EXISTS "Anyone can read reels" ON public.reels;
DROP POLICY IF EXISTS "Reels visible to public, owner, and followers" ON public.reels;

CREATE POLICY "Reels visible to public, owner, and followers" ON public.reels
  FOR SELECT USING (
    is_public = true
    OR auth.uid() = user_id
    OR EXISTS (
      SELECT 1
      FROM public.user_friends uf
      WHERE uf.user_id = auth.uid()
        AND uf.friend_id = public.reels.user_id
        AND uf.status = 'accepted'
    )
  );
