-- Add home_meals JSONB column to user_app_data for storing home-cooked meal logs.
-- Run this in your Supabase SQL Editor.

ALTER TABLE public.user_app_data
  ADD COLUMN IF NOT EXISTS home_meals JSONB NOT NULL DEFAULT '[]'::jsonb;
