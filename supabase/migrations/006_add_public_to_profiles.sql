-- Add is_public column to user_profiles. Run in Supabase SQL Editor.
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT true;
