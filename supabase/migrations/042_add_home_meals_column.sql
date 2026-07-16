-- Add home_meals JSONB column to user_app_data for storing home-cooked meal logs.
-- Run this in your Supabase SQL Editor. Safe to run multiple times.
-- (Renamed from 014_add_home_meals_column.sql — see supabase/README.md.)

ALTER TABLE public.user_app_data
  ADD COLUMN IF NOT EXISTS home_meals JSONB NOT NULL DEFAULT '[]'::jsonb;
