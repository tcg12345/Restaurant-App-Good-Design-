-- Run this in your Supabase SQL Editor to create the user_app_data table.
-- This stores all user restaurant data (ratings, lists, wishlist, metadata)
-- as JSONB columns — one row per user.
-- Safe to run multiple times (uses IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS public.user_app_data (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  ratings JSONB NOT NULL DEFAULT '[]'::jsonb,
  lists JSONB NOT NULL DEFAULT '[]'::jsonb,
  wishlist JSONB NOT NULL DEFAULT '[]'::jsonb,
  restaurant_meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  recent_views JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Add recent_views column if table already exists (safe migration)
DO $$ BEGIN
  ALTER TABLE public.user_app_data ADD COLUMN IF NOT EXISTS recent_views JSONB NOT NULL DEFAULT '[]'::jsonb;
EXCEPTION WHEN others THEN NULL;
END $$;

-- Enable Row Level Security so users can only access their own data
ALTER TABLE public.user_app_data ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (safe re-run)
DROP POLICY IF EXISTS "Users can read own data" ON public.user_app_data;
DROP POLICY IF EXISTS "Users can insert own data" ON public.user_app_data;
DROP POLICY IF EXISTS "Users can update own data" ON public.user_app_data;
DROP POLICY IF EXISTS "Users can delete own data" ON public.user_app_data;

-- Recreate policies
CREATE POLICY "Users can read own data"
  ON public.user_app_data FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own data"
  ON public.user_app_data FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own data"
  ON public.user_app_data FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own data"
  ON public.user_app_data FOR DELETE
  USING (auth.uid() = user_id);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_user_app_data_user_id ON public.user_app_data(user_id);
