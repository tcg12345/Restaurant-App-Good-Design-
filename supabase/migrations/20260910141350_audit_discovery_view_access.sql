-- This legacy view is absent from newer installations. The current app uses
-- user_profiles; preserve signed-in legacy discovery without bypassing RLS.
DO $$
BEGIN
  IF to_regclass('public.profiles_public_search') IS NOT NULL THEN
    ALTER VIEW public.profiles_public_search SET (security_invoker = true);
    REVOKE ALL ON public.profiles_public_search FROM PUBLIC, anon, authenticated;
    GRANT SELECT ON public.profiles_public_search TO authenticated;
  END IF;
END;
$$;
