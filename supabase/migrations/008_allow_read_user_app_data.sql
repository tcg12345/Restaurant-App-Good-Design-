-- Allow any authenticated user to read any user's app data (for viewing profiles).
-- Run this in your Supabase SQL Editor.

DROP POLICY IF EXISTS "Anyone can read app data" ON public.user_app_data;
CREATE POLICY "Anyone can read app data"
  ON public.user_app_data FOR SELECT
  USING (true);
