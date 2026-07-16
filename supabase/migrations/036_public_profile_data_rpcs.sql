-- 036: Restore cross-user profile/social reads of user_app_data via
-- SECURITY DEFINER RPCs — without loosening RLS.
--
-- Migration 008 made ALL of user_app_data world-readable (private ratings
-- and notes, private home meals, trips with hotel confirmation numbers,
-- chats). Migration 013 correctly reverted the table to owner-only SELECT,
-- but that left every cross-user read in the app silently returning []:
-- profile lists / wishlist / home cooking, and the social-feed home-meal
-- cards. The owner-only policy from 013 stays exactly as-is; these
-- functions expose ONLY the public-safe slices.
--
--   get_public_wishlist(target)              → [{restaurantId,name,cuisine,price,address,notes}]
--   get_public_lists(target)                 → [{id,name,emoji,restaurantIds}]
--   get_public_home_meals(target)            → [meal, …]           (only isPublic = true)
--   get_friends_public_home_meals(ids[])     → rows (user_id, meal) (only isPublic = true)
--   get_all_public_home_meals(exclude, n)    → rows (user_id, meal) platform-wide
--
-- Every function applies the same visibility rule the app already uses
-- (canViewProfile in src/lib/supabase-community.ts): the target's data is
-- returned only when the target profile is public, the caller IS the
-- target, or the caller has an ACCEPTED follow edge to the target in
-- user_friends. Otherwise the result is empty. Ratings, trips, chats,
-- recent views and the rest of restaurant_meta never leave the database.
--
-- home_meals note: meals live in the dedicated home_meals column AND/OR
-- the restaurant_meta.__home_meals__ fallback written by ListsContext, and
-- the live database may not have the dedicated column at all (see the code
-- comment in getFriendsPublicHomeMeals). All row access below goes through
-- to_jsonb(row) so the functions work on either schema without erroring.
-- Deletion tombstones (restaurant_meta.__deleted_meals__) are honored, and
-- dedicated-column entries win over the fallback on duplicate meal ids.
--
-- Run this in your Supabase SQL Editor.

-- ── Visibility rule (shared) ────────────────────────────────────────────
-- Matches canViewProfile: public profile, self, or accepted follow edge
-- viewer→target. A missing user_profiles row is treated as private.
CREATE OR REPLACE FUNCTION public.can_view_user_content(viewer uuid, target uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT target IS NOT NULL AND (
    viewer = target
    OR COALESCE((SELECT p.is_public FROM public.user_profiles p WHERE p.user_id = target), false)
    OR (viewer IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.user_friends f
          WHERE f.user_id = viewer AND f.friend_id = target AND f.status = 'accepted'))
  );
$$;

-- ── Wishlist ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_public_wishlist(target uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'restaurantId', w.item->>'restaurantId',
           'name',         COALESCE(w.item->>'name', ''),
           'cuisine',      COALESCE(w.item->>'cuisine', ''),
           'price',        COALESCE(w.item->>'price', ''),
           'address',      COALESCE(w.item->>'address', ''),
           'notes',        COALESCE(w.item->>'notes', '')
         ) ORDER BY w.ord), '[]'::jsonb)
  FROM public.user_app_data u
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(u.wishlist) = 'array' THEN u.wishlist ELSE '[]'::jsonb END
  ) WITH ORDINALITY AS w(item, ord)
  WHERE u.user_id = target
    AND public.can_view_user_content(auth.uid(), target);
$$;

-- ── Lists ───────────────────────────────────────────────────────────────
-- Only id/name/emoji/restaurantIds per list. Lists may embed recipes
-- (which carry their own isPrivate flag) and per-list rating overrides —
-- those are NOT public-safe and are never returned.
CREATE OR REPLACE FUNCTION public.get_public_lists(target uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id',            l.item->>'id',
           'name',          COALESCE(l.item->>'name', ''),
           'emoji',         COALESCE(l.item->>'emoji', ''),
           'restaurantIds', CASE WHEN jsonb_typeof(l.item->'restaurantIds') = 'array'
                                 THEN l.item->'restaurantIds' ELSE '[]'::jsonb END
         ) ORDER BY l.ord), '[]'::jsonb)
  FROM public.user_app_data u
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(u.lists) = 'array' THEN u.lists ELSE '[]'::jsonb END
  ) WITH ORDINALITY AS l(item, ord)
  WHERE u.user_id = target
    AND public.can_view_user_content(auth.uid(), target);
$$;

-- ── Home meals: shared implementation ───────────────────────────────────
-- Internal only (EXECUTE revoked below); the public wrappers follow.
-- only_users = NULL means "every user" (platform-wide scan).
CREATE OR REPLACE FUNCTION public.public_home_meals_impl(only_users uuid[], exclude_user uuid)
RETURNS TABLE(user_id uuid, meal jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  WITH viewable AS (
    SELECT u.user_id AS uid, to_jsonb(u) AS j
    FROM public.user_app_data u
    WHERE (only_users IS NULL OR u.user_id = ANY(only_users))
      AND (exclude_user IS NULL OR u.user_id <> exclude_user)
      AND public.can_view_user_content(auth.uid(), u.user_id)
  ),
  expanded AS (
    -- src 2 = dedicated home_meals column (may not exist → jsonb null),
    -- src 1 = restaurant_meta.__home_meals__ fallback. Column wins below.
    SELECT v.uid, v.j, s.meal, s.src
    FROM viewable v
    CROSS JOIN LATERAL (
      SELECT m.value AS meal, 1 AS src
      FROM jsonb_array_elements(
        CASE WHEN jsonb_typeof(v.j->'restaurant_meta'->'__home_meals__') = 'array'
             THEN v.j->'restaurant_meta'->'__home_meals__' ELSE '[]'::jsonb END) AS m
      UNION ALL
      SELECT m.value, 2
      FROM jsonb_array_elements(
        CASE WHEN jsonb_typeof(v.j->'home_meals') = 'array'
             THEN v.j->'home_meals' ELSE '[]'::jsonb END) AS m
    ) AS s
  ),
  deduped AS (
    SELECT DISTINCT ON (e.uid, e.meal->>'id') e.uid, e.meal
    FROM expanded e
    WHERE e.meal->>'id' IS NOT NULL
      AND e.meal->'isPublic' = 'true'::jsonb
      -- Deletion tombstones: drop meals the owner removed.
      AND NOT COALESCE(
        e.j->'restaurant_meta'->'__deleted_meals__' @> to_jsonb(e.meal->>'id'),
        false)
    ORDER BY e.uid, e.meal->>'id', e.src DESC
  )
  -- jsonb ordering compares numbers numerically; missing createdAt last.
  SELECT d.uid, d.meal
  FROM deduped d
  ORDER BY d.meal->'createdAt' DESC NULLS LAST;
$$;

-- ── Home meals: public wrappers ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_public_home_meals(target uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT COALESCE(jsonb_agg(t.meal ORDER BY t.meal->'createdAt' DESC NULLS LAST), '[]'::jsonb)
  FROM public.public_home_meals_impl(ARRAY[target], NULL) AS t;
$$;

CREATE OR REPLACE FUNCTION public.get_friends_public_home_meals(friend_ids uuid[])
RETURNS TABLE(user_id uuid, meal jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT t.user_id, t.meal FROM public.public_home_meals_impl(friend_ids, NULL) AS t;
$$;

CREATE OR REPLACE FUNCTION public.get_all_public_home_meals(exclude_user uuid DEFAULT NULL, meal_limit integer DEFAULT 60)
RETURNS TABLE(user_id uuid, meal jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT t.user_id, t.meal
  FROM public.public_home_meals_impl(NULL, exclude_user) AS t
  LIMIT GREATEST(COALESCE(meal_limit, 60), 0);
$$;

-- ── Grants ──────────────────────────────────────────────────────────────
-- Functions default to EXECUTE for PUBLIC — lock everything down, then
-- open only the client-facing wrappers. anon is included because public
-- profiles are viewable logged-out (see UserProfile.tsx canView).
REVOKE ALL ON FUNCTION public.can_view_user_content(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.public_home_meals_impl(uuid[], uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_public_wishlist(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_public_lists(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_public_home_meals(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_friends_public_home_meals(uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_all_public_home_meals(uuid, integer) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_public_wishlist(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_public_lists(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_public_home_meals(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_friends_public_home_meals(uuid[]) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_all_public_home_meals(uuid, integer) TO anon, authenticated, service_role;
