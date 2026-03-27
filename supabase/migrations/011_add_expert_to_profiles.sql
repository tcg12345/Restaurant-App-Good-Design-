-- Add is_expert flag to user_profiles. Run in Supabase SQL Editor.
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS is_expert BOOLEAN NOT NULL DEFAULT false;
