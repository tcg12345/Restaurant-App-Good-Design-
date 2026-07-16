-- 037: Make meta-fallback recipe reviews readable cross-user via a
-- SECURITY DEFINER RPC — without loosening RLS.
--
-- Reviews written through the meta fallback live in the reviewer's OWN
-- user_app_data row, under restaurant_meta.__my_meal_reviews__ (shaped
-- Record<mealId, {rating, notes, updatedAt}> — see
-- src/lib/supabase-home-meal-reviews.ts). user_app_data is owner-only
-- under RLS (migration 013), so the client's cross-user scans of other
-- reviewers' rows silently return nothing: meta-path review counts,
-- averages and notes never show for anyone but the reviewer themselves.
-- Same failure mode migration 036 fixed for profile lists / home meals;
-- same fix: a SECURITY DEFINER function that returns ONLY a public-safe
-- slice, leaving the RLS policy untouched.
--
--   get_meal_reviews_meta(meal_ids text[], scan_user_ids uuid[])
--     → rows (user_id, meal_id, rating, notes, updated_at)
--
-- No per-reviewer visibility gate (unlike 036's can_view_user_content):
-- recipe reviews are public-by-design — the primary recipe_reviews table
-- (migration 015) is readable by anyone via `FOR SELECT USING (true)`,
-- notes included. Gating the meta path on the reviewer's profile privacy
-- would make meta-written reviews vanish where table-written reviews of
-- the same recipe show, skewing counts per viewer. Nothing else in
-- restaurant_meta (restaurant ratings, trips, recent views, cook photos)
-- leaves the database: only entries under the reserved
-- __my_meal_reviews__ key, and only for the requested meal ids.
--
-- Run this in your Supabase SQL Editor.

CREATE OR REPLACE FUNCTION public.get_meal_reviews_meta(meal_ids text[], scan_user_ids uuid[])
RETURNS TABLE(user_id uuid, meal_id text, rating numeric, notes text, updated_at text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT u.user_id,
         r.key,
         CASE WHEN jsonb_typeof(r.value->'rating') = 'number'
              THEN (r.value->>'rating')::numeric ELSE 0 END,
         COALESCE(r.value->>'notes', ''),
         COALESCE(r.value->>'updatedAt', '')
  FROM public.user_app_data u
  CROSS JOIN LATERAL jsonb_each(
    CASE WHEN jsonb_typeof(u.restaurant_meta->'__my_meal_reviews__') = 'object'
         THEN u.restaurant_meta->'__my_meal_reviews__' ELSE '{}'::jsonb END
  ) AS r(key, value)
  WHERE u.user_id = ANY(scan_user_ids)
    AND r.key = ANY(meal_ids)
    AND jsonb_typeof(r.value) = 'object';
$$;

-- Functions default to EXECUTE for PUBLIC — lock down, then open to the
-- client-facing roles. anon is included because public recipes (and the
-- recipe_reviews table itself) are readable logged-out.
REVOKE ALL ON FUNCTION public.get_meal_reviews_meta(text[], uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_meal_reviews_meta(text[], uuid[]) TO anon, authenticated, service_role;
