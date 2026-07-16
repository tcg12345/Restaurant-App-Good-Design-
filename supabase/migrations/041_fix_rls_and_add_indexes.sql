-- Fix overly permissive RLS policy on user_app_data and add missing indexes.
-- Run this in your Supabase SQL Editor. Safe to run multiple times.
-- (Renamed from 013_fix_rls_and_add_indexes.sql — see supabase/README.md.)

-- Migration 008 made user_app_data readable by anyone.
-- This is too broad — private data (ratings, lists, wishlist) should only be
-- readable by the owning user. Community/shared data lives in community_* tables.
-- Restoring the original owner-only read policy.
DROP POLICY IF EXISTS "Anyone can read app data" ON public.user_app_data;
DROP POLICY IF EXISTS "Users can read own app data" ON public.user_app_data;
CREATE POLICY "Users can read own app data"
  ON public.user_app_data FOR SELECT
  USING (auth.uid() = user_id);

-- Add missing indexes for activity tables (user_id lookups)
CREATE INDEX IF NOT EXISTS idx_activity_likes_user ON public.activity_likes(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_comments_user ON public.activity_comments(user_id);

-- Add missing index for community_photos user lookups
CREATE INDEX IF NOT EXISTS idx_community_photos_user ON public.community_photos(user_id);

-- Add composite index for friend activity feed queries (user + time ordering)
CREATE INDEX IF NOT EXISTS idx_community_ratings_user_updated
  ON public.community_ratings(user_id, updated_at DESC);
