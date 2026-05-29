-- Add the "Ask a local" AI assistant chat history column to user_app_data
-- so the assistant's conversations (and recipes drafted from the Add Recipe
-- modal's "Create with AI" flow) survive sign-out / reload / redeploy and
-- follow the user across devices.
-- Safe to run multiple times.

ALTER TABLE public.user_app_data
  ADD COLUMN IF NOT EXISTS location_chat_history JSONB NOT NULL DEFAULT '[]'::jsonb;
