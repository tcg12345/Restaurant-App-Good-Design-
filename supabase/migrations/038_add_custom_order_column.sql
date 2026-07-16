-- 038: Dedicated custom_order column on user_app_data.
--
-- The user's manual drag-order of their rated list was synced ONLY through
-- restaurant_meta.__custom_order__ (a "dunder" key inside the meta JSONB
-- blob). Trips did the same via __trips__. Piggy-backing ordering/trips on
-- the meta blob doubled the clobber surface: every meta write (caching a
-- restaurant's hours/coords) rewrote the whole blob, so a stale device
-- could wipe the order or trips stashed there.
--
-- Trips already have a dedicated column (migration 012); custom order did
-- not. This adds one so ordering can move out of the meta blob too. After
-- this migration the app stops writing both dunder keys and strips them on
-- load (see ListsContext / supabase-db).
--
-- Run this in your Supabase SQL Editor. Safe to run multiple times.

ALTER TABLE public.user_app_data
  ADD COLUMN IF NOT EXISTS custom_order JSONB NOT NULL DEFAULT '[]'::jsonb;
