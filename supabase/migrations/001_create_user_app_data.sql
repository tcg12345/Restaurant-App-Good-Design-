-- Run this in your Supabase SQL Editor to create the user_app_data table.
-- This stores all user restaurant data (ratings, lists, wishlist, metadata)
-- as JSONB columns — one row per user.

CREATE TABLE IF NOT EXISTS public.user_app_data (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  ratings JSONB NOT NULL DEFAULT '[]'::jsonb,
  lists JSONB NOT NULL DEFAULT '[]'::jsonb,
  wishlist JSONB NOT NULL DEFAULT '[]'::jsonb,
  restaurant_meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable Row Level Security so users can only access their own data
ALTER TABLE public.user_app_data ENABLE ROW LEVEL SECURITY;

-- Policy: users can read their own data
CREATE POLICY "Users can read own data"
  ON public.user_app_data FOR SELECT
  USING (auth.uid() = user_id);

-- Policy: users can insert their own data
CREATE POLICY "Users can insert own data"
  ON public.user_app_data FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Policy: users can update their own data
CREATE POLICY "Users can update own data"
  ON public.user_app_data FOR UPDATE
  USING (auth.uid() = user_id);

-- Policy: users can delete their own data
CREATE POLICY "Users can delete own data"
  ON public.user_app_data FOR DELETE
  USING (auth.uid() = user_id);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_user_app_data_user_id ON public.user_app_data(user_id);
