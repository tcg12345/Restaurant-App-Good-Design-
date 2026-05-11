-- Add chats persistence columns to user_app_data so direct messages
-- and group conversations survive sign-out / reload / redeploy.
-- Safe to run multiple times.

ALTER TABLE public.user_app_data
  ADD COLUMN IF NOT EXISTS chats JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.user_app_data
  ADD COLUMN IF NOT EXISTS chats_read JSONB NOT NULL DEFAULT '{}'::jsonb;
