-- 089: taste twins are a Pro feature (entitlements 'taste-twins').
--
-- The client already asks before calling; this is the backstop. The
-- existing get_taste_twins (083) keeps its body under a private name and
-- the public name checks the plan first. effective_plan() (087) answers
-- 'pro' for everyone while the billing gates are off, so nothing changes
-- until launch.

ALTER FUNCTION public.get_taste_twins(integer) RENAME TO get_taste_twins_core;
REVOKE ALL ON FUNCTION public.get_taste_twins_core(integer) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_taste_twins(p_limit integer DEFAULT 25)
RETURNS TABLE (
  user_id uuid,
  similarity numeric,
  shared_cuisines text[],
  co_rated integer,
  co_agree integer,
  rating_count integer,
  cuisine_count integer,
  points integer
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF public.effective_plan() <> 'pro' THEN
    RAISE EXCEPTION 'pro_required' USING ERRCODE = 'P0001', HINT = 'Taste twins are part of GoodEats Pro.';
  END IF;
  RETURN QUERY SELECT * FROM public.get_taste_twins_core(p_limit);
END;
$$;
REVOKE ALL ON FUNCTION public.get_taste_twins(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_taste_twins(integer) TO authenticated;
