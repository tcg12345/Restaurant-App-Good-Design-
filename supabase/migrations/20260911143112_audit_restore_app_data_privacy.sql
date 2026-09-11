-- Migration 008's permissive policy survived the later owner-only policy.
-- Policies combine with OR: remove that bypass without changing shared RPCs.
DROP POLICY IF EXISTS "Anyone can read app data" ON public.user_app_data;
ALTER TABLE public.user_app_data ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can read own data" ON public.user_app_data;
CREATE POLICY "Users can read own data" ON public.user_app_data
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
