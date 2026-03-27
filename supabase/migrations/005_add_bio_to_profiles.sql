-- Add bio column to user_profiles. Run in Supabase SQL Editor.
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS bio TEXT NOT NULL DEFAULT '';
