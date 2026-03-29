-- Add friend_ids column to community_ratings. Run in Supabase SQL Editor.
ALTER TABLE public.community_ratings ADD COLUMN IF NOT EXISTS friend_ids TEXT[] NOT NULL DEFAULT '{}';
