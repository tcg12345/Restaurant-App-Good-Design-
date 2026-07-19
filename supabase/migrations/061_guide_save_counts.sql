-- ── Guide save counts ────────────────────────────────────────────────────
-- saved_guides SELECT is owner-scoped (026), so a client can't count other
-- users' bookmarks — which left the guides browser's "saves" stat fake.
-- Aggregate counts leak nothing personal; expose them via a SECURITY
-- DEFINER function, restricted to guides the caller could read anyway
-- (public+published, or their own).
CREATE OR REPLACE FUNCTION public.guide_save_counts(guide_ids uuid[])
RETURNS TABLE (guide_id uuid, saves bigint)
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = ''
AS $$
  SELECT s.guide_id, COUNT(*)::bigint AS saves
  FROM public.saved_guides s
  JOIN public.guides g ON g.id = s.guide_id
  WHERE s.guide_id = ANY(guide_ids)
    AND ((g.is_published AND g.visibility = 'public') OR g.user_id = auth.uid())
  GROUP BY s.guide_id;
$$;

REVOKE ALL ON FUNCTION public.guide_save_counts(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.guide_save_counts(uuid[]) TO authenticated;
