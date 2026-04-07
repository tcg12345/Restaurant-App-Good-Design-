-- Add trips JSONB column to user_app_data table
ALTER TABLE public.user_app_data ADD COLUMN IF NOT EXISTS trips JSONB NOT NULL DEFAULT '[]'::jsonb;
